/**
 * Simulateur de la plateforme TTN « El Fatoora » — MODE SIMULATION
 * =================================================================
 * Reproduit hors ligne le traitement d'un dépôt de facture électronique :
 *   1. vérification de la signature fournisseur XAdES-B (ds:Signature Id="SigFrs") ;
 *   2. contrôle des champs obligatoires du TEIF 1.8.8 et de la cohérence des totaux ;
 *   3. attribution d'une référence déterministe TTN-SIM-yyyymmdd-<MF7>-nnnnnn
 *      (nnnnnn dérivé du SHA-256 de la SignatureValue fournisseur) ;
 *   4. génération du QR code (PNG data URL, bibliothèque qrcode) dont le contenu est
 *      « référence|MF|date|TTC|HMAC » (HMAC-SHA256, secret EINVOICE_SIM_HMAC_SECRET) ;
 *   5. insertion du bloc <RefTtnVal> (ReferenceTTN refID="I-88", ReferenceCEV,
 *      ReferenceDate DateText ddMMyyHHmm, ordre du XSD TEIF 1.8.8) ;
 *   6. ajout de deux cachets simulés signés avec la clé de TEST « TTN El Fatoora
 *      Plateforme (TEST) » : SigCEv (document + RefTtnVal, hors signatures) et
 *      SigTTN (document entier, y compris SigFrs et SigCEv).
 *
 * ⚠ Aucune valeur fiscale : référence, QR et cachets sont produits localement.
 * Côté serveur uniquement (node:crypto).
 */
import { createHmac, X509Certificate } from 'node:crypto'
import QRCode from 'qrcode'
import {
  NS_DS, ALG_EXC_C14N, ALG_RSA_SHA256, ALG_SHA256, ALG_XPATH,
  parseXml, excC14n, sha256, b64, findElements, childElements, textOf, isDs,
  rsaSignSha256Digest, rsaVerifySha256, pemToDer, verifyChain, escXml,
} from './xml-dsig'
import { verifyTeifSignature, SIMULATION_LABEL, SIG_IDS, type VerifyResult } from './xades-signer'
import { TEST_TTN_CERT_PEM, TEST_TTN_KEY_PEM, TEST_SUB_CA_PEM, TEST_ROOT_CA_PEM } from './test-certs/test-chain'

export const TTN_SIM_REF_PREFIX = 'TTN-SIM'
export const TTN_SEAL_IDS = { cev: 'SigCEv', ttn: 'SigTTN' } as const
const DEFAULT_HMAC_SECRET = 'bellosuite-einvoice-simulation-hmac-NON-FISCAL'
const TZ = 'Africa/Tunis'

function hmacSecret(): string {
  return process.env.EINVOICE_SIM_HMAC_SECRET || DEFAULT_HMAC_SECRET
}

// ─── Dates (Africa/Tunis) ─────────────────────────────────────────────────────

function tunisParts(d: Date): Record<'year' | 'month' | 'day' | 'hour' | 'minute', string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') }
}

/** Date de référence TTN : ddMMyyHHmm, heure de Tunis. */
export function ttnReferenceDate(d: Date): string {
  const p = tunisParts(d)
  return `${p.day}${p.month}${p.year.slice(2)}${p.hour}${p.minute}`
}

function yyyymmdd(d: Date): string {
  const p = tunisParts(d)
  return `${p.year}${p.month}${p.day}`
}

// ─── Référence & QR ───────────────────────────────────────────────────────────

/**
 * Référence simulée déterministe : TTN-SIM-yyyymmdd-<7 premiers caractères du MF>-nnnnnn,
 * nnnnnn = 6 chiffres dérivés du SHA-256 de la SignatureValue fournisseur.
 */
export function simulatedTtnReference(signatureValue: string, matriculeFiscal: string, at: Date): string {
  const h = sha256(signatureValue.replace(/\s+/g, ''))
  const n = (h.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0')
  const mf7 = (matriculeFiscal || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 7).padEnd(7, '0')
  return `${TTN_SIM_REF_PREFIX}-${yyyymmdd(at)}-${mf7}-${n}`
}

export interface QrPayloadFields {
  reference: string
  matriculeFiscal: string
  referenceDate: string
  totalTTC: string
}

function qrMac(f: QrPayloadFields): string {
  return createHmac('sha256', hmacSecret())
    .update(`${f.reference}|${f.matriculeFiscal}|${f.referenceDate}|${f.totalTTC}`)
    .digest('hex')
    .slice(0, 32)
}

/** Contenu du QR : référence|MF|date|TTC|HMAC (HMAC-SHA256 tronqué à 128 bits, hex). */
export function buildQrPayload(f: QrPayloadFields): string {
  return `${f.reference}|${f.matriculeFiscal}|${f.referenceDate}|${f.totalTTC}|${qrMac(f)}`
}

/** Vérifie un contenu de QR simulé (intégrité HMAC). */
export function verifyQrPayload(payload: string): { valid: boolean; fields?: QrPayloadFields } {
  const parts = (payload || '').split('|')
  if (parts.length !== 5) return { valid: false }
  const [reference, matriculeFiscal, referenceDate, totalTTC, mac] = parts
  const fields = { reference, matriculeFiscal, referenceDate, totalTTC }
  return { valid: qrMac(fields) === mac, fields }
}

export async function qrPngDataUrl(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, scale: 4, type: 'image/png' })
}

// ─── Contrôles TEIF ───────────────────────────────────────────────────────────

const plain = (local: string) => (el: Element) => el.localName === local && !el.namespaceURI

function amountOf(scope: Element | undefined, code: string): number | null {
  if (!scope) return null
  const moa = findElements(scope, el => plain('Moa')(el) && el.getAttribute('amountTypeCode') === code)[0]
  if (!moa) return null
  const v = Number(textOf(findElements(moa, plain('Amount'))[0]))
  return Number.isFinite(v) ? v : null
}

export interface TeifSummary {
  invoiceNumber: string
  senderMf: string
  receiverId: string
  documentType: string
  issueDate: string
  totalHT: number | null
  totalTaxes: number | null
  totalTTC: number | null
}

/** Champs obligatoires TEIF 1.8.8 + cohérence des montants. */
export function checkTeifRequiredFields(doc: Document): { errors: string[]; summary: TeifSummary } {
  const errors: string[] = []
  const root = doc.documentElement
  const first = (scope: Element | Document | undefined, local: string) => (scope ? findElements(scope, plain(local))[0] : undefined)

  if (root.localName !== 'TEIF') errors.push('Racine <TEIF> attendue')
  if (!root.getAttribute('version')) errors.push('Attribut TEIF/@version manquant')
  if (root.getAttribute('controlingAgency') !== 'TTN') errors.push('Attribut TEIF/@controlingAgency="TTN" manquant')

  const header = first(doc, 'InvoiceHeader')
  const body = first(doc, 'InvoiceBody')
  if (!header) errors.push('InvoiceHeader manquant')
  if (!body) errors.push('InvoiceBody manquant')

  const sender = first(header, 'MessageSenderIdentifier')
  const senderMf = textOf(sender)
  if (!sender || sender.getAttribute('type') !== 'I-01' || !/^\d{7}[A-Z][APBFN][MPCNE]\d{3}$/.test(senderMf)) {
    errors.push('MessageSenderIdentifier : matricule fiscal I-01 (13 caractères) attendu')
  }
  const receiver = first(header, 'MessageRecieverIdentifier')
  if (!receiver || !textOf(receiver)) errors.push('MessageRecieverIdentifier manquant')

  const bgm = first(body, 'Bgm')
  const invoiceNumber = textOf(first(bgm, 'DocumentIdentifier'))
  const docType = first(bgm, 'DocumentType')
  if (!invoiceNumber) errors.push('Bgm/DocumentIdentifier (numéro de facture) manquant')
  if (!docType?.getAttribute('code')) errors.push('Bgm/DocumentType@code manquant')

  const issue = body ? findElements(body, el => plain('DateText')(el) && el.getAttribute('functionCode') === 'I-31')[0] : undefined
  if (!issue || !/^\d{6}$/.test(textOf(issue))) errors.push("Date d'émission (DateText I-31, ddMMyy) manquante")

  const partners = body ? findElements(body, plain('PartnerDetails')).map(p => p.getAttribute('functionCode')) : []
  if (!partners.includes('I-62')) errors.push('PartnerDetails fournisseur (I-62) manquant')
  if (!partners.includes('I-64')) errors.push('PartnerDetails client (I-64) manquant')

  const lines = body ? findElements(body, plain('Lin')) : []
  if (!lines.length) errors.push('LinSection : au moins une ligne <Lin> attendue')

  const invoiceMoa = first(body, 'InvoiceMoa')
  const totalHT = amountOf(invoiceMoa, 'I-176')
  const totalTaxes = amountOf(invoiceMoa, 'I-181')
  const totalTTC = amountOf(invoiceMoa, 'I-180')
  if (totalHT === null) errors.push('InvoiceMoa : total HT (I-176) manquant')
  if (totalTaxes === null) errors.push('InvoiceMoa : total taxes (I-181) manquant')
  if (totalTTC === null) errors.push('InvoiceMoa : total TTC (I-180) manquant')
  if (!first(body, 'InvoiceTax')) errors.push('InvoiceTax manquant')

  if (totalHT !== null && totalTaxes !== null && totalTTC !== null && Math.abs(totalHT + totalTaxes - totalTTC) > 0.005) {
    errors.push(`Totaux incohérents : HT ${totalHT.toFixed(3)} + taxes ${totalTaxes.toFixed(3)} ≠ TTC ${totalTTC.toFixed(3)}`)
  }
  if (totalHT !== null && lines.length) {
    const sumLines = lines.reduce((s, l) => s + (amountOf(l, 'I-171') ?? 0), 0)
    if (Math.abs(sumLines - totalHT) > 0.005) errors.push(`Somme des lignes ${sumLines.toFixed(3)} ≠ total HT ${totalHT.toFixed(3)}`)
  }

  return {
    errors,
    summary: {
      invoiceNumber, senderMf, receiverId: textOf(receiver), documentType: docType?.getAttribute('code') || '',
      issueDate: textOf(issue), totalHT, totalTaxes, totalTTC,
    },
  }
}

// ─── Cachets TTN simulés (XMLDSig enveloppé) ──────────────────────────────────

const XPATH_FOR: Record<string, string> = {
  [TTN_SEAL_IDS.cev]: 'not(ancestor-or-self::ds:Signature)',
  [TTN_SEAL_IDS.ttn]: "not(ancestor-or-self::ds:Signature[@Id='SigTTN'])",
}

/** Copie du document sans les ds:Signature retenues par le filtre de la référence du cachet. */
function sealedContent(doc: Document, sealId: string): string {
  const copy = doc.cloneNode(true) as Document
  const remove = findElements(copy, el =>
    isDs('Signature')(el) && (sealId === TTN_SEAL_IDS.cev || el.getAttribute('Id') === TTN_SEAL_IDS.ttn))
  for (const el of remove) el.parentNode?.removeChild(el)
  return excC14n(copy)
}

const certB64 = (pem: string) => pemToDer(pem).toString('base64')
const TTN_CHAIN = () => [TEST_TTN_CERT_PEM, TEST_SUB_CA_PEM, TEST_ROOT_CA_PEM]

function sealXml(sealId: string, digest: string, sigValue: string): string {
  return (
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${sealId}">` +
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="${ALG_EXC_C14N}"/>` +
    `<ds:SignatureMethod Algorithm="${ALG_RSA_SHA256}"/>` +
    `<ds:Reference Id="r-id-${sealId}" URI="">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="${ALG_XPATH}"><ds:XPath>${escXml(XPATH_FOR[sealId])}</ds:XPath></ds:Transform>` +
    `<ds:Transform Algorithm="${ALG_EXC_C14N}"/>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue>${digest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>` +
    `<ds:SignatureValue Id="value-${sealId}">${sigValue}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data>${TTN_CHAIN().map(p => `<ds:X509Certificate>${certB64(p)}</ds:X509Certificate>`).join('')}</ds:X509Data></ds:KeyInfo>` +
    `</ds:Signature>`
  )
}

function insertBeforeRootEnd(xml: string, fragment: string): string {
  const i = xml.lastIndexOf('</')
  return xml.slice(0, i) + fragment + xml.slice(i)
}

/** Ajoute un cachet TTN simulé (dernier enfant de <TEIF>). */
export function appendTtnSeal(xml: string, sealId: 'SigCEv' | 'SigTTN', keyPem: string = TEST_TTN_KEY_PEM): string {
  const digest = b64(sha256(sealedContent(parseXml(xml), sealId)))
  const draft = parseXml(insertBeforeRootEnd(xml, sealXml(sealId, digest, '')))
  const si = childElements(findElements(draft, el => isDs('Signature')(el) && el.getAttribute('Id') === sealId)[0], isDs('SignedInfo'))[0]
  const sigValue = b64(rsaSignSha256Digest(sha256(excC14n(si)), keyPem))
  return insertBeforeRootEnd(xml, sealXml(sealId, digest, sigValue))
}

/** Vérifie un cachet TTN simulé (condensé, valeur RSA, chaîne de test TTN). */
export function verifyTtnSeal(xml: string, sealId: 'SigCEv' | 'SigTTN'): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  let doc: Document
  try { doc = parseXml(xml) } catch (e) { return { valid: false, errors: [e instanceof Error ? e.message : String(e)] } }
  const sig = findElements(doc, el => isDs('Signature')(el) && el.getAttribute('Id') === sealId)
  if (sig.length !== 1) return { valid: false, errors: [`Cachet ${sealId} absent ou dupliqué`] }
  const si = childElements(sig[0], isDs('SignedInfo'))[0]
  const sv = childElements(sig[0], isDs('SignatureValue'))[0]
  const ref = si ? childElements(si, isDs('Reference'))[0] : undefined
  if (!si || !sv || !ref) return { valid: false, errors: [`Cachet ${sealId} incomplet`] }
  const xp = textOf(findElements(ref, isDs('XPath'))[0])
  if (xp !== XPATH_FOR[sealId]) errors.push(`Transformation XPath inattendue pour ${sealId}`)
  const expected = textOf(findElements(ref, isDs('DigestValue'))[0])
  if (expected !== b64(sha256(sealedContent(doc, sealId)))) errors.push(`Condensé ${sealId} invalide : document modifié après validation`)
  const certs = findElements(sig[0], isDs('X509Certificate')).map(c => new X509Certificate(Buffer.from(textOf(c), 'base64')))
  if (!certs.length) errors.push(`Certificat absent dans ${sealId}`)
  else {
    if (!rsaVerifySha256(excC14n(si), Buffer.from(textOf(sv), 'base64'), certs[0])) errors.push(`Valeur RSA ${sealId} invalide`)
    if (!certs[0].subject.includes('TTN El Fatoora')) errors.push(`${sealId} non émis par le certificat TTN (TEST)`)
    errors.push(...verifyChain(certs))
  }
  return { valid: errors.length === 0, errors }
}

// ─── Dépôt simulé ─────────────────────────────────────────────────────────────

export interface TtnSimulationResult {
  accepted: boolean
  errors: string[]
  signature?: VerifyResult
  summary?: TeifSummary
  referenceTTN?: string
  /** ddMMyyHHmm, heure de Tunis */
  referenceDate?: string
  validatedAt?: string
  qrPayload?: string
  qrDataUrl?: string
  validatedXml?: string
  simulated: true
  label: typeof SIMULATION_LABEL
}

/** Insère <RefTtnVal> après InvoiceBody/AdditionnalDocuments, avant les signatures. */
function insertRefTtnVal(xml: string, fragment: string): string {
  const m = /<(?:[A-Za-z_][\w.-]*:)?Signature\b[^>]*\bId="SigFrs"/.exec(xml)
  if (!m) throw new Error('Signature SigFrs introuvable')
  return xml.slice(0, m.index) + fragment + xml.slice(m.index)
}

/**
 * Simule le dépôt d'un TEIF signé auprès de TTN : renvoie le XML validé
 * (RefTtnVal + SigCEv + SigTTN) et le QR, ou la liste des motifs de rejet.
 */
export async function simulateTtnSubmission(signedXml: string, opts: { now?: Date } = {}): Promise<TtnSimulationResult> {
  const base = { simulated: true as const, label: SIMULATION_LABEL }
  let doc: Document
  try { doc = parseXml(signedXml) } catch (e) {
    return { ...base, accepted: false, errors: [e instanceof Error ? e.message : String(e)] }
  }
  if (findElements(doc, plain('RefTtnVal')).length || findElements(doc, el => isDs('Signature')(el) && el.getAttribute('Id') === TTN_SEAL_IDS.ttn).length) {
    return { ...base, accepted: false, errors: ['Facture déjà validée par TTN (RefTtnVal / SigTTN présents)'] }
  }

  const signature = verifyTeifSignature(signedXml, SIG_IDS.signature)
  const { errors: fieldErrors, summary } = checkTeifRequiredFields(doc)
  const errors = [
    ...signature.errors.map(e => `Signature fournisseur : ${e}`),
    ...fieldErrors,
  ]
  if (errors.length) return { ...base, accepted: false, errors, signature, summary }

  const now = opts.now ?? new Date()
  const sigValue = textOf(findElements(doc, el => isDs('SignatureValue')(el) && el.getAttribute('Id') === SIG_IDS.signatureValue)[0])
  const referenceTTN = simulatedTtnReference(sigValue, summary.senderMf, now)
  const referenceDate = ttnReferenceDate(now)
  const qrPayload = buildQrPayload({
    reference: referenceTTN,
    matriculeFiscal: summary.senderMf,
    referenceDate,
    totalTTC: (summary.totalTTC ?? 0).toFixed(3),
  })
  const qrDataUrl = await qrPngDataUrl(qrPayload)
  // ReferenceCEV : image PNG du QR en base64 (≤ 4000 car. selon le XSD), sinon son contenu texte
  const pngB64 = qrDataUrl.replace(/^data:image\/png;base64,/, '')
  const cev = pngB64.length <= 4000 ? pngB64 : qrPayload

  const refTtnVal =
    `<RefTtnVal>` +
    `<ReferenceTTN refID="I-88">${escXml(referenceTTN)}</ReferenceTTN>` +
    `<ReferenceCEV>${cev}</ReferenceCEV>` +
    `<ReferenceDate><DateText format="ddMMyyHHmm" functionCode="I-37">${referenceDate}</DateText></ReferenceDate>` +
    `</RefTtnVal>`

  let validatedXml = insertRefTtnVal(signedXml, refTtnVal)
  validatedXml = appendTtnSeal(validatedXml, TTN_SEAL_IDS.cev)
  validatedXml = appendTtnSeal(validatedXml, TTN_SEAL_IDS.ttn)

  return {
    ...base,
    accepted: true,
    errors: [],
    signature,
    summary,
    referenceTTN,
    referenceDate,
    validatedAt: now.toISOString(),
    qrPayload,
    qrDataUrl,
    validatedXml,
  }
}

/** Vérification complète d'un TEIF validé (simulation) : SigFrs + SigCEv + SigTTN. */
export function verifyValidatedTeif(xml: string): { valid: boolean; errors: string[] } {
  const frs = verifyTeifSignature(xml)
  const cev = verifyTtnSeal(xml, TTN_SEAL_IDS.cev)
  const ttn = verifyTtnSeal(xml, TTN_SEAL_IDS.ttn)
  const errors = [...frs.errors, ...cev.errors, ...ttn.errors]
  return { valid: errors.length === 0, errors }
}
