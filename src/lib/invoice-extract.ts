/**
 * « Zéro saisie » — extraction déterministe d'une facture fournisseur tunisienne à partir de son texte
 * (couche texte d'un PDF ou résultat OCR). Module PUR : aucune dépendance navigateur / serveur, testé par Jest.
 *
 * Champs : fournisseur, matricule fiscal (MF), n° de facture, date, lignes (désignation, qté, PU, total),
 * total HT, FODEC 1 %, TVA par taux (7/13/19 %), timbre fiscal, TTC — chacun avec une confiance 0..1.
 * Contrôles arithmétiques : HT + FODEC + TVA + timbre ≈ TTC, TVA ≈ base × taux, Σ lignes ≈ HT.
 *
 * Montants tunisiens : 3 décimales, virgule décimale, espace / point comme séparateur de milliers
 * (« 1 250,000 », « 1.250,000 »), formats anglais tolérés (« 1,250.000 »).
 */

export type Field<T> = { value: T | null; confidence: number }
export type VatEntry = { rate: number; base: number | null; amount: number; confidence: number }
export type ExtractedLine = {
  reference: string | null
  designation: string
  quantity: number
  unitPrice: number
  total: number
  confidence: number
}
export type InvoiceChecks = {
  /** HT + FODEC + TVA + timbre ≈ TTC */
  totalsConsistent: boolean | null
  /** Σ lignes ≈ HT */
  linesMatchSubtotal: boolean | null
  /** chaque TVA ≈ base × taux */
  vatConsistent: boolean | null
  /** écart TTC calculé − TTC lu */
  totalsGap: number | null
}
/** Nature de la pièce fournisseur : facture, bon de commande, devis, bon de livraison. */
export type PurchaseDocKind = 'INVOICE' | 'ORDER' | 'QUOTE' | 'DELIVERY_NOTE'
export const PURCHASE_DOC_KINDS: readonly PurchaseDocKind[] = ['INVOICE', 'ORDER', 'QUOTE', 'DELIVERY_NOTE']

export type InvoiceExtraction = {
  /** Type de document détecté (null = indéterminé, traité comme une facture). */
  documentType: Field<PurchaseDocKind>
  supplierName: Field<string>
  matriculeFiscal: Field<string>
  invoiceNumber: Field<string>
  /** ISO yyyy-mm-dd */
  date: Field<string>
  subtotal: Field<number>
  fodec: Field<number>
  vat: VatEntry[]
  vatTotal: Field<number>
  stamp: Field<number>
  total: Field<number>
  lines: ExtractedLine[]
  checks: InvoiceChecks
  warnings: string[]
}

export type ExtractOptions = {
  /** MF de l'entreprise utilisatrice (client de la facture) : exclu des candidats fournisseur. */
  ownMatriculeFiscal?: string | null
  /** Raison sociale de l'entreprise utilisatrice : exclue des candidats fournisseur. */
  ownName?: string | null
}

export const VAT_RATES = [7, 13, 19] as const
export const STAMP_DUTY = 1 // timbre fiscal 1,000 DT
export const FODEC_RATE = 1

// ─── Nombres ────────────────────────────────────────────────

export const round3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000
/** Tolérance d'arrondi : 5 millimes minimum, ou 0,05 % du montant. */
export const near = (a: number, b: number, tol = Math.max(0.005, Math.abs(b) * 0.0005)) => Math.abs(a - b) <= tol + 1e-9

/**
 * Convertit un montant écrit (« 1 250,000 », « 1.250,000 », « 1,250.000 », « 237.5 DT ») en nombre.
 * Renvoie null si illisible.
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  let s = String(raw).replace(/[\u00a0\u202f\u2009\s]/g, '').replace(/(TND|DT|D\.T\.?|دينار|د\.ت)/gi, '').replace(/[^\d.,-]/g, '')
  if (!s || !/\d/.test(s)) return null
  const neg = s.startsWith('-')
  s = s.replace(/-/g, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? ',' : '.'
    const thou = dec === ',' ? '.' : ','
    s = s.split(thou).join('').replace(dec, '.')
  } else if (lastComma >= 0) {
    const parts = s.split(',')
    // « 1,234,567 » = milliers ; sinon la virgule est décimale (usage tunisien)
    s = parts.length > 2 ? parts.join('') : parts.join('.')
  } else if (lastDot >= 0) {
    const parts = s.split('.')
    if (parts.length > 2) s = parts.join('')
  }
  const v = Number(s)
  if (!Number.isFinite(v)) return null
  return round3(neg ? -v : v)
}

// Montant isolé dans une ligne : anglais groupé, groupé espace/point + décimales virgule, ou simple.
const AMOUNT_RE = /(?<![\d/])(?:\d{1,3}(?:,\d{3})+\.\d{1,3}|\d{1,3}(?:[ \u00a0\u202f.]\d{3})+(?:,\d{1,3})?|\d+(?:[.,]\d{1,3})?)(?![\d/])/g

/** Montants d'une ligne (pourcentages et dates retirés). */
export function amountsIn(line: string): number[] {
  const cleaned = line
    .replace(/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/g, ' ')
    .replace(/\d{1,2}(?:[.,]\d+)?\s*%/g, ' ')
  const out: number[] = []
  for (const m of cleaned.matchAll(AMOUNT_RE)) {
    const v = parseAmount(m[0])
    if (v !== null) out.push(v)
  }
  return out
}

// ─── Normalisation texte ────────────────────────────────────

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function norm(s: string): string {
  return stripAccents(s).toLowerCase()
}

/** Chiffres arabes-indiens → ASCII, espaces normalisés. */
export function normalizeText(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0\u202f\u2009]/g, ' ')
}

// ─── Matricule fiscal ───────────────────────────────────────

const MF_RE = /\b(\d{6,8})\s*(?:[/\-. ]\s*)?([A-Z])?\s*[/\-. ]?\s*([A-Z])\s*[/\-. ]\s*([A-Z])\s*[/\-. ]\s*(\d{3})\b/g
const MF_COMPACT_RE = /\b(\d{7})([A-Z])([A-Z])([A-Z])(\d{3})\b/g

/**
 * Normalise un matricule fiscal : « 1234567/A/M/000 », « 1234567 A M 000 », « 1234567B/A/M/000 »,
 * « 1234567BAM000 » → forme à barres (« 1234567/A/M/000 », « 1234567B/A/M/000 »). null si non reconnu.
 */
export function normalizeMf(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.toUpperCase().trim()
  MF_RE.lastIndex = 0
  const m = MF_RE.exec(s)
  if (m) {
    const digits = m[1].padStart(7, '0')
    return `${digits}${m[2] ?? ''}/${m[3]}/${m[4]}/${m[5]}`
  }
  MF_COMPACT_RE.lastIndex = 0
  const c = MF_COMPACT_RE.exec(s.replace(/[\s/.-]/g, ''))
  if (c) return `${c[1]}${c[2]}/${c[3]}/${c[4]}/${c[5]}`
  return null
}

/** Clé de comparaison MF : chiffres + lettre clé (sans code TVA / catégorie / établissement). */
export function mfKey(raw: string | null | undefined): string | null {
  const n = normalizeMf(raw)
  if (n) return n.split('/')[0]
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits.length >= 6 ? digits.padStart(7, '0') : null
}

function findMfs(lines: string[]): Array<{ mf: string; line: number }> {
  const out: Array<{ mf: string; line: number }> = []
  lines.forEach((l, i) => {
    const u = l.toUpperCase()
    MF_RE.lastIndex = 0
    for (const m of u.matchAll(MF_RE)) {
      const n = normalizeMf(m[0])
      if (n && !out.some((o) => o.mf === n)) out.push({ mf: n, line: i })
    }
    for (const m of u.replace(/[ ]/g, '').matchAll(MF_COMPACT_RE)) {
      const n = normalizeMf(m[0])
      if (n && !out.some((o) => o.mf === n)) out.push({ mf: n, line: i })
    }
  })
  return out
}

// ─── Contexte client (à exclure) ────────────────────────────

const CLIENT_RE = /\b(client|doit|adress[ée]e?\s+[àa]|factur[ée]\s+[àa]|destinataire|acheteur|bill\s*to|customer|sold\s*to)\b|العميل|الحريف|المشتري/i

function clientZone(lines: string[]): Set<number> {
  const zone = new Set<number>()
  lines.forEach((l, i) => {
    if (CLIENT_RE.test(stripAccents(l))) for (let k = i; k <= i + 4 && k < lines.length; k++) zone.add(k)
  })
  return zone
}

// ─── Fournisseur ────────────────────────────────────────────

const LEGAL_FORM_RE = /\b(s\.?a\.?r\.?l|s\.?u\.?a\.?r\.?l|s\.?a|ste|societe|ets|etablissements?|sarl|suarl|company|co\.|ltd|group(e)?|industries?|textiles?|trading|distribution)\b|شركة|مؤسسة/i
const NOT_NAME_RE = /(facture|invoice|devis|bon de|page|date|tel|t[ée]l[ée]phone|fax|e-?mail|adresse|rue|avenue|route|code|matricule|m\.?f|rib|banque|capital|rc\b|r\.c|www\.|http|@|فاتورة|الهاتف|العنوان)/i

function findSupplierName(lines: string[], client: Set<number>, opts: ExtractOptions): Field<string> {
  const own = opts.ownName ? norm(opts.ownName) : null
  const isOwn = (s: string) => !!own && own.length > 2 && norm(s).includes(own)
  // 1) Libellé explicite
  for (const [i, l] of lines.entries()) {
    const m = l.match(/(?:fournisseur|raison\s+sociale|vendeur|supplier|المزود)\s*[:\-]\s*(.{3,80})/i)
    if (m && !client.has(i) && !isOwn(m[1])) return { value: cleanName(m[1]), confidence: 0.85 }
  }
  // En-tête : chaque ligne est découpée en cellules (colonnes PDF / OCR séparées par 2 espaces ou « | »),
  // pour qu'un titre « FACTURE » ou un n° placé sur la même ligne n'élimine pas la raison sociale.
  const head = lines.slice(0, 15)
  // Un titre « FACTURE » en fin de ligne (OCR qui a fusionné les colonnes avec un seul espace) est retiré.
  const cells = (l: string) => l.replace(/\s+(?:facture|invoice|فاتورة)\s*$/i, '').split(/\s{2,}|\s*\|\s*|\t/).map((c) => c.trim()).filter(Boolean)
  const usable = (c: string) => c.length >= 3 && !NOT_NAME_RE.test(stripAccents(c)) && !isOwn(c)
  // 2) Cellule avec forme juridique, hors zone client
  for (const [i, l] of head.entries()) {
    if (client.has(i)) continue
    for (const c of cells(l)) {
      if (usable(c) && LEGAL_FORM_RE.test(stripAccents(c)) && /[A-Za-z\u0600-\u06ff]{3}/.test(c)) return { value: cleanName(c), confidence: 0.75 }
    }
  }
  // 3) Première cellule textuelle plausible
  for (const [i, l] of head.entries()) {
    if (client.has(i)) continue
    for (const c of cells(l)) {
      if (usable(c) && (c.match(/[A-Za-z\u0600-\u06ff]/g) ?? []).length >= 3 && (c.match(/\d/g) ?? []).length <= 2) return { value: cleanName(c), confidence: 0.45 }
    }
  }
  return { value: null, confidence: 0 }
}

function cleanName(s: string): string {
  return s.replace(/\s{2,}/g, ' ').replace(/[|_*]+/g, '').replace(/\s*[-–:]\s*$/, '').trim().slice(0, 120)
}

// ─── N° de facture ──────────────────────────────────────────

function findInvoiceNumber(lines: string[], kind: PurchaseDocKind | null = 'INVOICE'): Field<string> {
  const patterns: Array<[RegExp, number]> = [
    [/(?:facture|invoice|fact\.?)\s*(?:n\s*[°ºo?*]\.?|num[ée]ro|no\.?|#)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i, 0.9],
    [/(?:n\s*[°º?*]|num[ée]ro)\s*(?:de\s+)?(?:la\s+)?facture\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i, 0.9],
    [/فاتورة\s*(?:عدد|رقم)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i, 0.85],
    [/\bfacture\s*[:\-]\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i, 0.7],
    // Bon de commande / devis / bon de livraison : même numéro de pièce (jamais pour une facture : ce serait sa référence de commande)
    ...(kind === 'INVOICE' ? [] : ([
    [/\b(?:bon\s+de\s+commande|commande|b\.?\s?c\.?|purchase\s+order|p\.?o\.?|devis|proforma|pro-forma|offre(?:\s+de\s+prix)?|quotation|quote|bon\s+de\s+livraison|b\.?\s?l\.?|delivery\s+note)\s*(?:n\s*[°ºo?*]\.?|num[ée]ro|no\.?|#)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i, 0.85],
    [/(?:أمر\s+(?:بال)?شراء|طلبية|عرض\s+سعر|وصل\s+(?:ال)?تسليم)\s*(?:عدد|رقم)\s*[:.\-]?\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i, 0.8],
    [/\b(?:bon\s+de\s+commande|devis|bon\s+de\s+livraison)\s*[:\-]\s*([A-Z0-9][A-Z0-9/\-_.]{1,30})/i, 0.7],
    ] as Array<[RegExp, number]>)),
  ]
  for (const [re, conf] of patterns) {
    for (const l of lines) {
      const m = l.match(re)
      if (m && /\d/.test(m[1])) return { value: m[1].replace(/[.\-/]+$/, ''), confidence: conf }
    }
  }
  return { value: null, confidence: 0 }
}

// ─── Type de document ───────────────────────────────────────

/** Titres reconnus, par type ; le titre le plus haut dans la page l'emporte (« Facture » en tête prime sur « réf. bon de commande »). */
const DOC_KIND_RES: Array<[PurchaseDocKind, RegExp]> = [
  ['INVOICE', /\b(facture|invoice)\b(?!\s+(?:proforma|pro-forma))|فاتورة(?!\s+(?:أولية|مبدئية))/i],
  ['ORDER', /\b(bon\s+de\s+commande|commande\s+fournisseur|purchase\s+order|b\.\s?c\.)|أمر\s+(?:بال)?شراء|طلبية|سند\s+طلب/i],
  ['QUOTE', /\b(devis|proforma|pro-forma|offre\s+de\s+prix|quotation|quote)\b|عرض\s+(?:ال)?سعر|فاتورة\s+(?:أولية|مبدئية)/i],
  ['DELIVERY_NOTE', /\b(bon\s+de\s+livraison|delivery\s+note|b\.\s?l\.)|وصل\s+(?:ال)?تسليم|وصل\s+(?:ال)?استلام/i],
]
/** Mentions de référence (« Réf. BC : … », « suivant devis n° … ») : ne désignent pas le type de la pièce. */
const DOC_REF_CONTEXT_RE = /(r[ée]f\.?|r[ée]f[ée]rence|suivant|selon|votre|v\/|n\/|li[ée]e?\s+[àa]|vs\b|your|our)\s*(?:[:.\-]\s*)?(?:au\s+|à\s+|notre\s+|votre\s+)?$/i

/**
 * Détecte le type d'une pièce fournisseur à partir de son texte : facture, bon de commande, devis (proforma), bon de livraison.
 * Heuristique : titre de pièce le plus haut (hors mentions de référence « réf. BC », « suivant devis ») ;
 * « Facture » en tête prime (une facture cite souvent son BC / BL). Confiance plus forte en tête de document.
 */
export function detectDocumentType(text: string): Field<PurchaseDocKind> {
  const lines = normalizeText(text).split('\n').map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return { value: null, confidence: 0 }
  const headZone = Math.max(8, Math.ceil(lines.length / 3))
  const found: Array<{ kind: PurchaseDocKind; index: number }> = []
  for (const [kind, re] of DOC_KIND_RES) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re)
      if (!m || m.index === undefined) continue
      const before = lines[i].slice(0, m.index)
      if (DOC_REF_CONTEXT_RE.test(before)) continue
      // « Facture » dans un pied (« arrêtée la présente facture ») ne compte pas comme titre si elle n'est pas en tête
      if (kind === 'INVOICE' && /arr[êe]t[ée]e?|pr[ée]sente/i.test(before)) continue
      found.push({ kind, index: i })
      break
    }
  }
  if (!found.length) return { value: null, confidence: 0 }
  // Une facture cite souvent son BC / BL en en-tête : un titre « Facture » en tête l'emporte ; sinon le titre le plus haut.
  const invoiceHead = found.find((f) => f.kind === 'INVOICE' && f.index < headZone)
  const best = invoiceHead ?? found.reduce((a, b) => (b.index < a.index ? b : a))
  return { value: best.kind, confidence: best.index < headZone ? 0.85 : 0.6 }
}

// ─── Date ───────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, fev: 2, feb: 2, mar: 3, avr: 4, apr: 4, jun: 6, jul: 7, juil: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function isoDate(d: number, m: number, y: number): string | null {
  if (y < 100) y += 2000
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Dates d'une ligne (dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy, yyyy-mm-dd, « 5 octobre 2026 »). */
export function datesIn(line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const v = isoDate(+m[3], +m[2], +m[1]); if (v) out.push(v)
  }
  for (const m of line.matchAll(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4}|\d{2})\b/g)) {
    const v = isoDate(+m[1], +m[2], +m[3]); if (v) out.push(v)
  }
  for (const m of norm(line).matchAll(/\b(\d{1,2})(?:er)?\s+([a-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const mo = MONTHS[m[2]]
    if (mo) { const v = isoDate(+m[1], mo, +m[3]); if (v) out.push(v) }
  }
  return out
}

function findDate(lines: string[]): Field<string> {
  const skip = /(e|é)ch(e|é)ance|due|livraison|valid|استحقاق/i
  for (const l of lines) {
    if (skip.test(l)) continue
    if (/(date|le\s+\d|du\s+\d|تاريخ|bizerte|tunis|sfax|sousse|monastir|nabeul|ariana|ben arous|kairouan|gab[eè]s)/i.test(l)) {
      const d = datesIn(l)
      if (d.length) return { value: d[0], confidence: /date|تاريخ/i.test(l) ? 0.9 : 0.75 }
    }
  }
  for (const l of lines) {
    if (skip.test(l)) continue
    const d = datesIn(l)
    if (d.length) return { value: d[0], confidence: 0.5 }
  }
  return { value: null, confidence: 0 }
}

// ─── Totaux ─────────────────────────────────────────────────

/** Valeur d'un libellé : dernier montant de la ligne, sinon premier montant de la ligne suivante. */
function labelled(lines: string[], re: RegExp, exclude?: RegExp): number | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (!re.test(stripAccents(l)) || (exclude && exclude.test(stripAccents(l)))) continue
    const tail = stripAccents(l).replace(re, '|').split('|').slice(1).join(' ')
    const a = amountsIn(tail.length ? tail : l)
    if (a.length) return a[a.length - 1]
    const next = lines[i + 1] ? amountsIn(lines[i + 1]) : []
    if (next.length === 1) return next[0]
  }
  return null
}

const HT_RE = /(net\s+(commercial\s+)?h\.?\s*t\.?|total\s+net\s+h\.?\s*t\.?|total\s+h\.?\s*t\.?(?:va)?|montant\s+(total\s+)?h\.?\s*t\.?|total\s+hors\s+taxes?|sous[-\s]total|subtotal|total\s+excl|المبلغ\s+دون)/i
const HT_EXCL = /(brut|t\.?t\.?c|remise)/i
const TTC_RE = /(net\s+[àa]\s+payer|total\s+t\.?t\.?c\.?|montant\s+t\.?t\.?c\.?|total\s+toutes\s+taxes|total\s+general|grand\s+total|total\s+incl|amount\s+due|المبلغ\s+الجملي|الصافي\s+للدفع)/i
const FODEC_RE = /(fodec|f\.o\.d\.e\.c)/i
const STAMP_RE = /(timbre(\s+fiscal)?|droit\s+de\s+timbre|stamp\s+duty|الطابع\s+الجبائي|طابع)/i
const VAT_TOTAL_RE = /(total\s+t\.?v\.?a\.?|montant\s+t\.?v\.?a\.?\s*$|total\s+taxes?|mt\s+tva)/i

function findVat(lines: string[]): VatEntry[] {
  const out: VatEntry[] = []
  for (const l of lines) {
    const s = stripAccents(l)
    if (!/(t\.?v\.?a|vat|الأداء\s+على\s+القيمة\s+المضافة|القيمة\s+المضافة)/i.test(s)) continue
    if (/total\s+t\.?v\.?a/i.test(s) && !/\d{1,2}\s*%/.test(s)) continue
    const rm = s.match(/(\d{1,2})(?:[.,]0+)?\s*%/)
    if (!rm) continue
    const rate = Number(rm[1])
    if (!(VAT_RATES as readonly number[]).includes(rate)) continue
    const amounts = amountsIn(s).filter((a) => a > 0)
    if (!amounts.length) continue
    let base: number | null = null
    let amount = amounts[amounts.length - 1]
    let confidence = 0.7
    // Base + montant sur la ligne : garder le couple cohérent (montant ≈ base × taux)
    for (let a = 0; a < amounts.length; a++) for (let b = 0; b < amounts.length; b++) {
      if (a !== b && near(amounts[a] * rate / 100, amounts[b], Math.max(0.01, amounts[b] * 0.002))) { base = amounts[a]; amount = amounts[b]; confidence = 0.9 }
    }
    if (!out.some((v) => v.rate === rate)) out.push({ rate, base, amount, confidence })
  }
  return out
}

// ─── Lignes ─────────────────────────────────────────────────

/** Découpages possibles d'une suite de jetons numériques (fusion des groupes de milliers « 1 250,000 »). */
function numberParses(tokens: string[]): number[][] {
  const results: number[][] = []
  const canMerge = (i: number, j: number) => {
    if (j === i) return true
    if (!/^\d{1,3}$/.test(tokens[i])) return false
    for (let k = i + 1; k < j; k++) if (!/^\d{3}$/.test(tokens[k])) return false
    return /^\d{3}(?:,\d{1,3})?$/.test(tokens[j])
  }
  const rec = (i: number, acc: number[]) => {
    if (results.length >= 64) return
    if (i === tokens.length) { results.push(acc); return }
    for (let j = i; j < tokens.length && j < i + 3; j++) {
      if (!canMerge(i, j)) continue
      const v = parseAmount(tokens.slice(i, j + 1).join(' '))
      if (v !== null) rec(j + 1, [...acc, v])
      // « 1.200 » : décimal (1,2) ou milliers (1 200) selon la facture — on essaie les deux
      if (j === i && /^\d{1,3}\.\d{3}$/.test(tokens[i])) rec(j + 1, [...acc, Number(tokens[i].replace('.', ''))])
    }
  }
  rec(0, [])
  return results
}

const LINE_SKIP_RE = /(total|t\.?v\.?a|fodec|timbre|net\s+[àa]\s+payer|sous-total|remise\s+globale|montant\s+h|arr[êe]t[ée]e?|page\s+\d|tel|fax|rib|capital|code\s+tva|matricule|المجموع|الجملي|طابع)/i

function findLines(lines: string[]): ExtractedLine[] {
  const out: ExtractedLine[] = []
  for (const raw of lines) {
    const l = raw.replace(/\|/g, ' ').replace(/\s{2,}/g, ' ').trim()
    if (l.length < 6 || LINE_SKIP_RE.test(stripAccents(l))) continue
    const toks = l.split(' ')
    // queue numérique (montants, % de TVA/remise, unités tolérées)
    let k = toks.length
    while (k > 0 && /^(\d[\d.,]*%?|%|u|pce?s?|kg|m|ml|l|dt|tnd)$/i.test(toks[k - 1])) k--
    const tail = toks.slice(k).filter((t) => /\d/.test(t))
    if (tail.length < 3) continue
    let head = toks.slice(0, k).join(' ').trim()
    if (!/[A-Za-z\u0600-\u06ff]{2}/.test(head)) continue
    const pct = tail.filter((t) => t.endsWith('%')).map((t) => parseAmount(t) ?? 0)
    const nums = tail.filter((t) => !t.endsWith('%'))
    let best: { q: number; p: number; t: number; score: number } | null = null
    for (const parse of numberParses(nums)) {
      for (let a = 0; a < parse.length; a++) for (let b = a + 1; b < parse.length; b++) for (let c = b + 1; c < parse.length; c++) {
        const [q, p, t] = [parse[a], parse[b], parse[c]]
        if (q <= 0 || p <= 0 || t <= 0) continue
        const remise = pct.find((r) => r > 0 && r < 100 && !(VAT_RATES as readonly number[]).includes(r))
        const ok = near(q * p, t, Math.max(0.01, t * 0.001)) || (remise !== undefined && near(q * p * (1 - remise / 100), t, Math.max(0.01, t * 0.001)))
        if (!ok) continue
        // préférer le total en dernière position et le moins de nombres ignorés
        const score = (c === parse.length - 1 ? 2 : 0) + (b === a + 1 && c === b + 1 ? 1 : 0)
        if (!best || score > best.score) best = { q, p, t, score }
      }
    }
    if (!best) continue
    let reference: string | null = null
    const refm = head.match(/^([A-Z]{1,5}[-_]?\d{2,}[A-Z0-9-]*|\d{3,}[A-Z]?[-_]?\w*)\s+(.+)$/i)
    if (refm && /[A-Za-z\u0600-\u06ff]{2}/.test(refm[2])) { reference = refm[1]; head = refm[2] }
    out.push({ reference, designation: head.replace(/^\d+\s*[-.)]\s*/, '').slice(0, 300), quantity: best.q, unitPrice: best.p, total: best.t, confidence: 0.8 })
  }
  return out
}

// ─── Contrôles & inférences ─────────────────────────────────

/**
 * Recalcule les contrôles arithmétiques, infère les montants manquants et ajuste les confiances.
 * Appelée après l'extraction déterministe ET après la fusion IA (une seule source de vérité).
 */
export function finalizeExtraction(x: InvoiceExtraction): InvoiceExtraction {
  const r: InvoiceExtraction = JSON.parse(JSON.stringify(x))
  r.warnings = r.warnings.filter((w) => !w.startsWith('check:'))
  const fodec = r.fodec.value ?? 0
  const linesSum = r.lines.length ? round3(r.lines.reduce((s, l) => s + l.total, 0)) : null

  // HT absent : Σ lignes
  if (r.subtotal.value === null && linesSum !== null) r.subtotal = { value: linesSum, confidence: 0.6 }

  // TVA totale
  const vatSum = r.vat.length ? round3(r.vat.reduce((s, v) => s + v.amount, 0)) : null
  if (r.vatTotal.value === null && vatSum !== null) r.vatTotal = { value: vatSum, confidence: Math.min(...r.vat.map((v) => v.confidence)) }
  else if (r.vatTotal.value !== null && vatSum !== null && !near(r.vatTotal.value, vatSum)) r.warnings.push('check:vat_sum_mismatch')

  // Inférences à partir de la relation HT + FODEC + TVA + timbre = TTC
  const ht = r.subtotal.value, tva = r.vatTotal.value, ttc = r.total.value
  let stamp = r.stamp.value
  if (ht !== null && tva !== null && ttc !== null && stamp === null) {
    const gap = round3(ttc - (ht + fodec + tva))
    if (near(gap, STAMP_DUTY)) { stamp = STAMP_DUTY; r.stamp = { value: STAMP_DUTY, confidence: 0.75 } }
    else if (near(gap, 0)) r.stamp = { value: 0, confidence: 0.6 }
  }
  const st = r.stamp.value ?? 0
  if (ttc === null && ht !== null && tva !== null) r.total = { value: round3(ht + fodec + tva + st), confidence: 0.55 }
  if (tva === null && ht !== null && ttc !== null) {
    // timbre non lu : si l'écart avec 1 DT de timbre donne un taux légal exact, on le retient
    if (r.stamp.value === null) {
      const withStamp = round3(ttc - ht - fodec - STAMP_DUTY)
      if (VAT_RATES.some((rt) => near((ht + fodec) * rt / 100, withStamp, Math.max(0.01, withStamp * 0.002)))) r.stamp = { value: STAMP_DUTY, confidence: 0.55 }
    }
    const v = round3(ttc - ht - fodec - (r.stamp.value ?? 0))
    if (v >= 0) {
      r.vatTotal = { value: v, confidence: 0.55 }
      if (!r.vat.length) {
        const rate = VAT_RATES.find((rt) => near((ht + fodec) * rt / 100, v, Math.max(0.01, v * 0.002)))
        if (rate) r.vat = [{ rate, base: round3(ht + fodec), amount: v, confidence: 0.6 }]
      }
    }
  }
  if (ht === null && tva !== null && ttc !== null) {
    const v = round3(ttc - tva - st - fodec)
    if (v > 0) r.subtotal = { value: v, confidence: 0.55 }
  }

  // Contrôles
  const H = r.subtotal.value, T = r.vatTotal.value, C = r.total.value
  const checks: InvoiceChecks = { totalsConsistent: null, linesMatchSubtotal: null, vatConsistent: null, totalsGap: null }
  if (H !== null && T !== null && C !== null) {
    const gap = round3(H + fodec + T + st - C)
    checks.totalsGap = gap
    checks.totalsConsistent = near(H + fodec + T + st, C, Math.max(0.01, C * 0.0005))
  }
  if (linesSum !== null && H !== null) checks.linesMatchSubtotal = near(linesSum, H, Math.max(0.01, H * 0.001))
  if (r.vat.length && H !== null) {
    const fullBase = H + fodec
    checks.vatConsistent = r.vat.every((v) => {
      const base = v.base ?? (r.vat.length === 1 ? fullBase : null)
      return base === null ? true : near(base * v.rate / 100, v.amount, Math.max(0.01, v.amount * 0.002))
    })
    // TVA unique sans base explicite : vérifie aussi HT seul (FODEC parfois hors base sur certaines factures)
    if (!checks.vatConsistent && r.vat.length === 1 && r.vat[0].base === null) {
      checks.vatConsistent = near(H * r.vat[0].rate / 100, r.vat[0].amount, Math.max(0.01, r.vat[0].amount * 0.002))
    }
  }
  if (r.fodec.value !== null && H !== null && !near(H * FODEC_RATE / 100, r.fodec.value, Math.max(0.01, r.fodec.value * 0.002))) r.warnings.push('check:fodec_rate')
  r.checks = checks

  // Confiances : un montant confirmé par l'arithmétique monte, contredit il descend
  const bump = (f: Field<number>, ok: boolean | null) => {
    if (f.value === null || ok === null) return f
    return { value: f.value, confidence: ok ? Math.max(f.confidence, 0.95) : Math.min(f.confidence, 0.4) }
  }
  r.subtotal = bump(r.subtotal, checks.totalsConsistent === false ? false : (checks.totalsConsistent || checks.linesMatchSubtotal))
  r.vatTotal = bump(r.vatTotal, checks.totalsConsistent === false ? false : (checks.totalsConsistent && checks.vatConsistent !== false))
  r.total = bump(r.total, checks.totalsConsistent)
  if (r.stamp.value !== null) r.stamp = bump(r.stamp, checks.totalsConsistent)
  if (r.fodec.value !== null) r.fodec = bump(r.fodec, checks.totalsConsistent)
  r.vat = r.vat.map((v) => ({ ...v, confidence: checks.vatConsistent && checks.totalsConsistent ? Math.max(v.confidence, 0.95) : checks.vatConsistent === false ? Math.min(v.confidence, 0.4) : v.confidence }))
  if (checks.linesMatchSubtotal) r.lines = r.lines.map((l) => ({ ...l, confidence: Math.max(l.confidence, 0.95) }))
  else if (checks.linesMatchSubtotal === false) r.lines = r.lines.map((l) => ({ ...l, confidence: Math.min(l.confidence, 0.6) }))

  if (checks.totalsConsistent === false) r.warnings.push('check:totals_mismatch')
  if (checks.linesMatchSubtotal === false) r.warnings.push('check:lines_mismatch')
  if (checks.vatConsistent === false) r.warnings.push('check:vat_rate_mismatch')
  return r
}

// ─── Point d'entrée ─────────────────────────────────────────

export function emptyExtraction(): InvoiceExtraction {
  const f = <T>(): Field<T> => ({ value: null, confidence: 0 })
  return {
    documentType: f(), supplierName: f(), matriculeFiscal: f(), invoiceNumber: f(), date: f(),
    subtotal: f(), fodec: f(), vat: [], vatTotal: f(), stamp: f(), total: f(),
    lines: [], checks: { totalsConsistent: null, linesMatchSubtotal: null, vatConsistent: null, totalsGap: null }, warnings: [],
  }
}

export function extractInvoice(text: string, opts: ExtractOptions = {}): InvoiceExtraction {
  const r = emptyExtraction()
  const lines = normalizeText(text).split('\n').map((l) => l.replace(/ {2,}/g, '  ').trimEnd()).filter((l) => l.trim().length)
  if (!lines.length) return r
  const client = clientZone(lines)

  // MF : premier hors zone client et différent du MF de l'entreprise
  const ownKey = mfKey(opts.ownMatriculeFiscal)
  const mfs = findMfs(lines).filter((m) => !ownKey || mfKey(m.mf) !== ownKey)
  const supplierMf = mfs.find((m) => !client.has(m.line)) ?? (mfs.length === 1 ? mfs[0] : null)
  if (supplierMf) r.matriculeFiscal = { value: supplierMf.mf, confidence: client.has(supplierMf.line) ? 0.5 : mfs.length > 1 ? 0.8 : 0.9 }

  r.documentType = detectDocumentType(text)
  r.supplierName = findSupplierName(lines, client, opts)
  r.invoiceNumber = findInvoiceNumber(lines, r.documentType.value ?? 'INVOICE')
  r.date = findDate(lines)

  const ht = labelled(lines, HT_RE, HT_EXCL)
  if (ht !== null) r.subtotal = { value: ht, confidence: 0.8 }
  const ttc = labelled(lines, TTC_RE)
  if (ttc !== null) r.total = { value: ttc, confidence: 0.8 }
  const fodec = labelled(lines, FODEC_RE)
  if (fodec !== null) r.fodec = { value: fodec, confidence: 0.75 }
  const stamp = labelled(lines, STAMP_RE)
  if (stamp !== null && stamp > 0 && stamp < 10) r.stamp = { value: stamp, confidence: 0.85 }
  r.vat = findVat(lines)
  const vatTotal = labelled(lines, VAT_TOTAL_RE)
  if (vatTotal !== null) r.vatTotal = { value: vatTotal, confidence: 0.75 }
  r.lines = findLines(lines)

  if (!r.matriculeFiscal.value) r.warnings.push('missing:matriculeFiscal')
  if (!r.invoiceNumber.value) r.warnings.push('missing:invoiceNumber')
  if (!r.total.value) r.warnings.push('missing:total')
  return finalizeExtraction(r)
}

// ─── Fusion avec le résultat IA ─────────────────────────────

/** Résultat IA (déjà validé par zod côté serveur) — mêmes champs, valeurs brutes. */
export type AiInvoice = {
  /** « facture » | « bon_de_commande » | « devis » | « bon_de_livraison » (ou équivalent anglais) */
  documentType?: string | null
  supplierName?: string | null
  matriculeFiscal?: string | null
  invoiceNumber?: string | null
  date?: string | null
  subtotal?: number | null
  fodec?: number | null
  vat?: Array<{ rate: number; base?: number | null; amount: number }> | null
  vatTotal?: number | null
  stamp?: number | null
  total?: number | null
  lines?: Array<{ reference?: string | null; designation: string; quantity: number; unitPrice: number; total: number }> | null
}

const AI_CONF = 0.6

/** Type renvoyé par l'IA (libellé libre FR / EN / AR ou code) → PurchaseDocKind, null si inconnu. */
export function normalizeDocKind(raw: string | null | undefined): PurchaseDocKind | null {
  if (!raw) return null
  const s = stripAccents(String(raw)).toLowerCase().replace(/[_\-]+/g, ' ').trim()
  if ((PURCHASE_DOC_KINDS as readonly string[]).includes(s.toUpperCase().replace(/ /g, '_'))) return s.toUpperCase().replace(/ /g, '_') as PurchaseDocKind
  if (/proforma|pro forma|devis|quot|offre|عرض/.test(s)) return 'QUOTE'
  if (/commande|purchase order|^po$|^bc$|order|شراء|طلبية/.test(s)) return 'ORDER'
  if (/livraison|delivery|^bl$|تسليم/.test(s)) return 'DELIVERY_NOTE'
  if (/facture|invoice|فاتورة/.test(s)) return 'INVOICE'
  return null
}

function mergeText(det: Field<string>, ai: string | null | undefined, valid: (s: string) => string | null): Field<string> {
  const a = ai ? valid(ai) : null
  if (!a) return det
  if (det.value === null) return { value: a, confidence: AI_CONF }
  if (norm(det.value).replace(/\W/g, '') === norm(a).replace(/\W/g, '')) return { value: det.value, confidence: Math.max(det.confidence, 0.95) }
  // désaccord : l'extraction déterministe forte l'emporte, sinon l'IA (lecture souvent plus fiable de l'image)
  return det.confidence >= 0.8 ? det : { value: a, confidence: 0.5 }
}

/**
 * Fusionne l'extraction déterministe et la proposition IA. RÈGLE : l'IA ne l'emporte jamais sur l'arithmétique —
 * ses montants ne sont retenus que si l'ensemble obtenu est cohérent (HT + FODEC + TVA + timbre ≈ TTC)
 * et que l'extraction déterministe ne l'était pas déjà. Les lignes IA doivent vérifier qté × PU ≈ total.
 */
export function mergeAiExtraction(det: InvoiceExtraction, ai: AiInvoice | null | undefined): InvoiceExtraction {
  if (!ai) return det
  const base = finalizeExtraction(det)
  const out: InvoiceExtraction = JSON.parse(JSON.stringify(base))

  const aiKind = normalizeDocKind(ai.documentType)
  if (aiKind) {
    if (base.documentType.value === null) out.documentType = { value: aiKind, confidence: AI_CONF }
    else if (base.documentType.value === aiKind) out.documentType = { value: aiKind, confidence: Math.max(base.documentType.confidence, 0.95) }
    else if (base.documentType.confidence < 0.8) out.documentType = { value: aiKind, confidence: 0.5 }
  }
  out.supplierName = mergeText(base.supplierName, ai.supplierName, (s) => cleanName(s) || null)
  out.matriculeFiscal = mergeText(base.matriculeFiscal, ai.matriculeFiscal, normalizeMf)
  out.invoiceNumber = mergeText(base.invoiceNumber, ai.invoiceNumber, (s) => (/\d/.test(s) ? s.trim().slice(0, 40) : null))
  out.date = mergeText(base.date, ai.date, (s) => {
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? isoDate(+m[3], +m[2], +m[1]) : (datesIn(s)[0] ?? null)
  })

  // Montants : candidat « IA comble les trous » puis candidat « IA complet » ; on garde le premier cohérent.
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? round3(v) : null)
  const aiVat: VatEntry[] = (ai.vat ?? [])
    .filter((v) => (VAT_RATES as readonly number[]).includes(Number(v.rate)) && num(v.amount) !== null)
    .map((v) => ({ rate: Number(v.rate), base: num(v.base), amount: num(v.amount)!, confidence: AI_CONF }))
  const aiLines: ExtractedLine[] = (ai.lines ?? [])
    .filter((l) => l && l.designation && num(l.quantity) && num(l.unitPrice) !== null && num(l.total) !== null && near(l.quantity * l.unitPrice, l.total, Math.max(0.01, l.total * 0.002)))
    .map((l) => ({ reference: l.reference ?? null, designation: String(l.designation).slice(0, 300), quantity: num(l.quantity)!, unitPrice: num(l.unitPrice)!, total: num(l.total)!, confidence: AI_CONF }))

  const fill = (f: Field<number>, v: number | null): Field<number> => (f.value === null && v !== null ? { value: v, confidence: AI_CONF } : f)
  const take = (v: number | null): Field<number> => (v !== null ? { value: v, confidence: AI_CONF } : { value: null, confidence: 0 })

  if (!base.checks.totalsConsistent) {
    const gapFilled: InvoiceExtraction = {
      ...out,
      subtotal: fill(base.subtotal, num(ai.subtotal)), fodec: fill(base.fodec, num(ai.fodec)),
      vatTotal: fill(base.vatTotal, num(ai.vatTotal)), stamp: fill(base.stamp, num(ai.stamp)), total: fill(base.total, num(ai.total)),
      vat: base.vat.length ? base.vat : aiVat,
    }
    const aiOnly: InvoiceExtraction = {
      ...out,
      subtotal: take(num(ai.subtotal)), fodec: take(num(ai.fodec)), vatTotal: take(num(ai.vatTotal)), stamp: take(num(ai.stamp)), total: take(num(ai.total)), vat: aiVat,
    }
    const candidates = [gapFilled, aiOnly].map(finalizeExtraction)
    const good = candidates.find((c) => c.checks.totalsConsistent)
    if (good) {
      out.subtotal = good.subtotal; out.fodec = good.fodec; out.vatTotal = good.vatTotal; out.stamp = good.stamp; out.total = good.total; out.vat = good.vat
    } else {
      out.warnings = [...out.warnings.filter((w) => w !== 'ai:amounts_rejected'), 'ai:amounts_rejected']
    }
  }

  // Lignes : IA seulement si les nôtres sont absentes / incohérentes et que les siennes le sont moins
  if (aiLines.length && base.checks.linesMatchSubtotal !== true) {
    const ht = out.subtotal.value
    const aiSum = round3(aiLines.reduce((s, l) => s + l.total, 0))
    const aiMatches = ht !== null && near(aiSum, ht, Math.max(0.01, ht * 0.001))
    if (aiMatches || !base.lines.length) out.lines = aiLines
  }
  return finalizeExtraction(out)
}

// ─── Rapprochement fournisseur / articles ───────────────────

const LEGAL_WORDS = /\b(s\.?a\.?r\.?l|s\.?u\.?a\.?r\.?l|s\.?a|ste|societe|ets|etablissements?|sarl|suarl|ltd|co|company|et\s+cie|cie|groupe?)\b/g

export function normalizeName(s: string): string {
  return norm(s).replace(/\./g, '').replace(/'/g, ' ').replace(LEGAL_WORDS, ' ').replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const dp = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

/** Similarité 0..1 (max de Jaccard sur les mots et ratio de Levenshtein). */
export function nameSimilarity(a: string, b: string): number {
  const x = normalizeName(a), y = normalizeName(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '))
  const inter = [...tx].filter((t) => ty.has(t)).length
  const jac = inter / new Set([...tx, ...ty]).size
  const lev = 1 - levenshtein(x, y) / Math.max(x.length, y.length)
  const contains = x.includes(y) || y.includes(x) ? 0.85 : 0
  return Math.max(jac, lev, contains)
}

export type SupplierCandidate = { id: string; name: string; matriculeFiscal?: string | null }
export type SupplierMatch = { id: string; by: 'mf' | 'name'; score: number } | null

/** Fournisseur du tenant : par MF (chiffres + clé), sinon par nom (similarité ≥ 0,72). */
export function matchSupplier(x: Pick<InvoiceExtraction, 'matriculeFiscal' | 'supplierName'>, suppliers: SupplierCandidate[]): SupplierMatch {
  const k = mfKey(x.matriculeFiscal.value)
  if (k) {
    const s = suppliers.find((sp) => mfKey(sp.matriculeFiscal) === k)
    if (s) return { id: s.id, by: 'mf', score: 1 }
  }
  if (x.supplierName.value) {
    let best: SupplierMatch = null
    for (const sp of suppliers) {
      const score = nameSimilarity(x.supplierName.value, sp.name)
      if (score >= 0.72 && (!best || score > best.score)) best = { id: sp.id, by: 'name', score }
    }
    return best
  }
  return null
}

export type ProductCandidate = { id: string; code: string; name: string }

/** Article : référence = code exact (ou code présent dans la désignation), sinon nom similaire (≥ 0,75). */
export function matchProduct(line: Pick<ExtractedLine, 'reference' | 'designation'>, products: ProductCandidate[]): { id: string; by: 'code' | 'name'; score: number } | null {
  const ref = line.reference ? norm(line.reference).replace(/\s/g, '') : null
  const des = norm(line.designation)
  for (const p of products) {
    const code = norm(p.code).replace(/\s/g, '')
    if (!code) continue
    if (ref && ref === code) return { id: p.id, by: 'code', score: 1 }
    if (code.length >= 3 && new RegExp(`(^|\\W)${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`).test(des)) return { id: p.id, by: 'code', score: 0.95 }
  }
  let best: { id: string; by: 'name'; score: number } | null = null
  for (const p of products) {
    const score = nameSimilarity(line.designation, p.name)
    if (score >= 0.75 && (!best || score > best.score)) best = { id: p.id, by: 'name', score }
  }
  return best
}

/** Seuil sous lequel un champ est surligné pour relecture. */
export const LOW_CONFIDENCE = 0.7
