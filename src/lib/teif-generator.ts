/**
 * TEIF XML generator — facture électronique tunisienne (TTN / El Fatoora)
 * ======================================================================
 * Conforme au schéma officiel TTN « facture_INVOIC » version 1.8.8 (variante sans
 * signature) et au Guide d'implémentation TEIF V2.0 (annexe A, référentiels I-0 à I-17).
 * Le XSD est versionné dans docs/ttn/teif-1.8.8-withoutSig.xsd et vérifié par les tests.
 *
 * Ce fichier produit le XML NON SIGNÉ. Avant dépôt, il doit être signé en XAdES-B
 * (bloc ds:Signature Id="SigFrs") avec le certificat TunTrust de l'émetteur, sans
 * plus aucune modification du contenu (cf. Spécifications signature fournisseur V3.0).
 *
 * Codes utilisés :
 *   I-01 matricule fiscal (13 car.), I-02 CIN · I-11 facture, I-12 avoir, I-13 note d'honoraires
 *   I-31 date d'émission, I-32 date limite de paiement · I-62 fournisseur, I-64 client
 *   I-1601 droit de timbre, I-1602 TVA, I-162 FODEC
 *   I-171 montant HT ligne, I-183 PU HT · I-176 total HT, I-177 base taxe, I-178 montant taxe,
 *   I-180 total TTC, I-181 total taxes
 */

import { normalizeMatricule, isValidCin } from '@/lib/matricule'

export interface TEIFData {
  invoiceNumber: string
  type: string
  issueDate: string
  dueDate?: string
  tenant: {
    name: string
    matriculeFiscal: string
    address: string
    city: string
    zipCode: string
    phone?: string
  }
  client: {
    name: string
    matriculeFiscal: string
    address: string
    city: string
    zipCode?: string
  }
  items: any[]
  totals: {
    subtotalHT: number
    totalFodec: number
    totalVAT: number
    timbreFiscal: number
    totalTTC: number
    vatSummary: { [rate: number]: { base: number, amount: number } }
  }
}

export const TEIF_VERSION = '1.8.8'
export const FODEC_RATE = 1

// ─── Identifiants ─────────────────────────────────────────────────────────────

/**
 * Matricule fiscal au format TEIF : 13 caractères sans séparateur
 * (7 chiffres, clé, code TVA A/P/B/F/N, catégorie M/P/C/N/E, 3 chiffres d'établissement).
 * « 0736202/X/A/M/000 » → « 0736202XAM000 ». Renvoie null si incomplet.
 */
export function teifMatricule(mf: string | null | undefined): string | null {
  const m = normalizeMatricule(mf)
  return /^\d{7}[A-HJ-NP-TV-Z][APBFN][MPCNE]\d{3}$/.test(m) ? m : null
}

export function teifCin(id: string | null | undefined): string | null {
  const c = (id || '').replace(/\s/g, '')
  return isValidCin(c) ? c : null
}

export function teifDocumentType(type: string): { code: string; label: string } {
  const t = (type || '').toUpperCase()
  if (t.includes('CREDIT') || t.includes('AVOIR')) return { code: 'I-12', label: "Facture d'avoir" }
  if (t.includes('HONOR')) return { code: 'I-13', label: "Note d'honoraire" }
  if (t.includes('EXPORT')) return { code: 'I-15', label: 'Facture Export' }
  return { code: 'I-11', label: 'Facture' }
}

// ─── Formatage ────────────────────────────────────────────────────────────────

/** ISO YYYY-MM-DD → ddMMyy */
export function teifDate(iso: string): string {
  const [y, m, d] = (iso || '').slice(0, 10).split('-')
  return d && m && y ? `${d}${m}${y.slice(2)}` : ''
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .trim()
}

const r3 = (n: number) => Math.round(n * 1000) / 1000
const amt = (n: number) => r3(n).toFixed(3)
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v))
const rateStr = (n: number) => String(Math.round(n * 100) / 100)

function moa(code: string, value: number): string {
  return `<Moa amountTypeCode="${code}" currencyCodeList="ISO_4217"><Amount currencyIdentifier="TND">${amt(value)}</Amount></Moa>`
}

// ─── Calculs depuis les lignes ────────────────────────────────────────────────

export interface TEIFLine {
  code: string
  description: string
  unit: string
  quantity: number
  unitPriceHT: number
  totalHT: number
  vatRate: number
  fodec: number
  vat: number
}

export function normalizeLines(items: any[]): TEIFLine[] {
  return (items || []).map((it, i) => {
    const quantity = num(it.quantity)
    const unitPriceHT = num(it.unitPriceHT)
    const discount = num(it.discount)
    const gross = quantity * unitPriceHT
    const totalHT = it.totalHT !== undefined && it.totalHT !== null ? num(it.totalHT) : gross * (1 - discount / 100)
    const vatRate = num(it.vatRate)
    const fodec = it.fodecApply ? (it.fodecAmount !== undefined ? num(it.fodecAmount) : totalHT * FODEC_RATE / 100) : 0
    const vat = it.vatAmount !== undefined && it.vatAmount !== null ? num(it.vatAmount) : (totalHT + fodec) * vatRate / 100
    return {
      code: String(it.productId || it.reference || i + 1).slice(0, 35),
      description: String(it.description || `Article ${i + 1}`).slice(0, 500),
      unit: String(it.unit || 'UNIT').slice(0, 8),
      quantity,
      unitPriceHT,
      totalHT: r3(totalHT),
      vatRate,
      fodec: r3(fodec),
      vat: r3(vat),
    }
  })
}

// ─── Validation ───────────────────────────────────────────────────────────────

/** Erreurs bloquantes avant génération (TTN rejetterait le dépôt). */
export function validateTEIFData(data: TEIFData): string[] {
  const errors: string[] = []
  if (!teifMatricule(data.tenant.matriculeFiscal)) {
    errors.push("Matricule fiscal de l'émetteur incomplet : 13 caractères attendus (ex. 1234567AAM000)")
  }
  if (!teifMatricule(data.client.matriculeFiscal) && !teifCin(data.client.matriculeFiscal)) {
    errors.push('Client sans matricule fiscal complet (13 caractères) ni CIN (8 chiffres)')
  }
  if (!data.invoiceNumber) errors.push('Numéro de facture manquant')
  if (!teifDate(data.issueDate)) errors.push("Date d'émission invalide")
  if (!data.items?.length) errors.push('Aucune ligne de facture')
  if (!data.tenant.address) errors.push("Adresse de l'émetteur manquante")
  // Cohérence des totaux (tolérance 5 millimes)
  const lines = normalizeLines(data.items)
  const ht = lines.reduce((s, l) => s + l.totalHT, 0)
  const fodec = lines.reduce((s, l) => s + l.fodec, 0)
  const vat = lines.reduce((s, l) => s + l.vat, 0)
  const ttc = ht + fodec + vat + num(data.totals.timbreFiscal)
  if (lines.length && Math.abs(ttc - num(data.totals.totalTTC)) > 0.005) {
    errors.push(`Total TTC incohérent : lignes ${amt(ttc)} ≠ facture ${amt(num(data.totals.totalTTC))}`)
  }
  return errors
}

export class TEIFValidationError extends Error {
  errors: string[]
  constructor(errors: string[]) {
    super('Facture non conforme TEIF : ' + errors.join(' ; '))
    this.errors = errors
  }
}

// ─── Génération ───────────────────────────────────────────────────────────────

function partnerXml(functionCode: string, name: string, id: { type: string; value: string }, isCompany: boolean, address?: { desc: string; city?: string; zip?: string }): string {
  const adr = address?.desc
    ? `<PartnerAdresses lang="fr"><AdressDescription>${esc(address.desc)}</AdressDescription>` +
      (address.city ? `<CityName>${esc(address.city).slice(0, 35)}</CityName>` : '') +
      (address.zip ? `<PostalCode>${esc(address.zip).slice(0, 17)}</PostalCode>` : '') +
      `<Country codeList="ISO_3166-1">TN</Country></PartnerAdresses>`
    : ''
  return (
    `<PartnerDetails functionCode="${functionCode}"><Nad>` +
    `<PartnerIdentifier type="${id.type}">${id.value}</PartnerIdentifier>` +
    `<PartnerName nameType="${isCompany ? 'Qualification' : 'Physical'}">${esc(name)}</PartnerName>` +
    adr +
    `</Nad></PartnerDetails>`
  )
}

function taxDetailsXml(code: string, label: string, rate: number, base: number | null, amount: number): string {
  return (
    `<InvoiceTaxDetails><Tax><TaxTypeName code="${code}">${label}</TaxTypeName>` +
    `<TaxDetails><TaxRate>${rateStr(rate)}</TaxRate></TaxDetails></Tax>` +
    (base !== null ? `<AmountDetails>${moa('I-177', base)}</AmountDetails>` : '') +
    `<AmountDetails>${moa('I-178', amount)}</AmountDetails>` +
    `</InvoiceTaxDetails>`
  )
}

/**
 * Génère le XML TEIF 1.8.8 non signé.
 * @throws TEIFValidationError si les données ne permettent pas un fichier valide.
 */
export function generateTEIFXml(data: TEIFData): string {
  const errors = validateTEIFData(data)
  if (errors.length) throw new TEIFValidationError(errors)

  const sender = teifMatricule(data.tenant.matriculeFiscal)!
  const clientMf = teifMatricule(data.client.matriculeFiscal)
  const clientId = clientMf ? { type: 'I-01', value: clientMf } : { type: 'I-02', value: teifCin(data.client.matriculeFiscal)! }
  const doc = teifDocumentType(data.type)
  const lines = normalizeLines(data.items)

  const totalHT = r3(lines.reduce((s, l) => s + l.totalHT, 0))
  const timbre = num(data.totals.timbreFiscal)

  // TVA par taux (base = HT + FODEC des lignes concernées)
  const vatByRate = new Map<number, { base: number; amount: number }>()
  const fodecBase = { base: 0, amount: 0 }
  for (const l of lines) {
    const v = vatByRate.get(l.vatRate) ?? { base: 0, amount: 0 }
    v.base += l.totalHT + l.fodec
    v.amount += l.vat
    vatByRate.set(l.vatRate, v)
    if (l.fodec > 0) { fodecBase.base += l.totalHT; fodecBase.amount += l.fodec }
  }
  const totalTaxes = r3([...vatByRate.values()].reduce((s, v) => s + v.amount, 0) + fodecBase.amount + timbre)
  const totalTTC = r3(totalHT + totalTaxes)

  const dates =
    `<DateText format="ddMMyy" functionCode="I-31">${teifDate(data.issueDate)}</DateText>` +
    (data.dueDate && teifDate(data.dueDate) ? `<DateText format="ddMMyy" functionCode="I-32">${teifDate(data.dueDate)}</DateText>` : '')

  const linXml = lines
    .map((l, i) =>
      `<Lin><ItemIdentifier>${i + 1}</ItemIdentifier>` +
      `<LinImd lang="fr"><ItemCode>${esc(l.code)}</ItemCode><ItemDescription>${esc(l.description)}</ItemDescription></LinImd>` +
      `<LinQty><Quantity measurementUnit="${esc(l.unit)}">${l.quantity.toFixed(3)}</Quantity></LinQty>` +
      `<LinTax><TaxTypeName code="I-1602">TVA</TaxTypeName><TaxDetails><TaxRate>${rateStr(l.vatRate)}</TaxRate></TaxDetails></LinTax>` +
      `<LinMoa><MoaDetails>${moa('I-183', l.unitPriceHT)}</MoaDetails><MoaDetails>${moa('I-171', l.totalHT)}</MoaDetails></LinMoa>` +
      `</Lin>`,
    )
    .join('')

  const taxXml =
    [...vatByRate.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([rate, v]) => taxDetailsXml('I-1602', 'TVA', rate, v.base, v.amount))
      .join('') +
    (fodecBase.amount > 0 ? taxDetailsXml('I-162', 'FODEC', FODEC_RATE, fodecBase.base, fodecBase.amount) : '') +
    (timbre > 0 ? taxDetailsXml('I-1601', 'Droit de timbre', 0, null, timbre) : '')

  const isCompany = (mf: string | null) => !!mf && mf[9] === 'M'

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<TEIF version="${TEIF_VERSION}" controlingAgency="TTN">` +
    `<InvoiceHeader>` +
    `<MessageSenderIdentifier type="I-01">${sender}</MessageSenderIdentifier>` +
    `<MessageRecieverIdentifier type="${clientId.type}">${clientId.value}</MessageRecieverIdentifier>` +
    `</InvoiceHeader>` +
    `<InvoiceBody>` +
    `<Bgm><DocumentIdentifier>${esc(data.invoiceNumber)}</DocumentIdentifier><DocumentType code="${doc.code}">${esc(doc.label)}</DocumentType></Bgm>` +
    `<Dtm>${dates}</Dtm>` +
    `<PartnerSection>` +
    partnerXml('I-62', data.tenant.name, { type: 'I-01', value: sender }, true, {
      desc: data.tenant.address, city: data.tenant.city, zip: data.tenant.zipCode,
    }) +
    partnerXml('I-64', data.client.name, clientId, clientMf ? isCompany(clientMf) : false, data.client.address
      ? { desc: data.client.address, city: data.client.city, zip: data.client.zipCode }
      : undefined) +
    `</PartnerSection>` +
    `<LinSection>${linXml}</LinSection>` +
    `<InvoiceMoa>` +
    `<AmountDetails>${moa('I-176', totalHT)}</AmountDetails>` +
    `<AmountDetails>${moa('I-181', totalTaxes)}</AmountDetails>` +
    `<AmountDetails>${moa('I-180', totalTTC)}</AmountDetails>` +
    `</InvoiceMoa>` +
    `<InvoiceTax>${taxXml}</InvoiceTax>` +
    `</InvoiceBody>` +
    `</TEIF>\n`
  )
}
