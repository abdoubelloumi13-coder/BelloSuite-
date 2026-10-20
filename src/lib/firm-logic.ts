/**
 * Espace cabinet comptable — logique PURE (sans base), testée dans __tests__/firm-logic.test.ts.
 *
 *  - codes d'invitation (entreprise → cabinet) : 8 caractères lisibles, stockés hachés, usage unique, 7 jours ;
 *  - échéances des déclarations mensuelles (TVA, retenues à la source) : le 15 du mois suivant pour les personnes
 *    physiques ; le 28 pour les personnes morales, ramené au 20 en télédéclaration (art. 18-IV Code TVA,
 *    art. 52-IV Code IRPP/IS, LF 2024 art. 69). Un dimanche reporte au lendemain (jours fériés non gérés) ;
 *  - indicateurs et alertes par dossier client ;
 *  - exports pour le logiciel du cabinet : journal comptable et registre des factures (CSV « Excel FR »).
 */
import { createHash, randomBytes } from 'crypto'

// ─── Codes d'invitation ──────────────────────────────────────────────────────

/** Sans 0/O, 1/I/L : dicté au téléphone ou recopié sans erreur. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const INVITE_TTL_DAYS = 7

export function generateInviteCode(rand: (n: number) => Buffer = randomBytes): string {
  const bytes = rand(8)
  let out = ''
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4)}`
}

/** Majuscules, sans espaces ni tirets ; null si le format est impossible. */
export function normalizeInviteCode(code: string | null | undefined): string | null {
  const c = String(code ?? '').toUpperCase().replace(/[\s-]/g, '')
  if (c.length !== 8) return null
  for (const ch of c) if (!ALPHABET.includes(ch)) return null
  return c
}

export function hashInviteCode(code: string): string {
  const n = normalizeInviteCode(code)
  if (!n) throw new Error('Code invalide')
  return createHash('sha256').update(`bellosuite-firm-invite:${n}`).digest('hex')
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000)
}

export type InviteState = 'OK' | 'USED' | 'EXPIRED'
export function inviteState(inv: { expiresAt: Date | string; usedAt?: Date | string | null }, now: Date = new Date()): InviteState {
  if (inv.usedAt) return 'USED'
  if (new Date(inv.expiresAt).getTime() <= now.getTime()) return 'EXPIRED'
  return 'OK'
}

// ─── Échéances fiscales ──────────────────────────────────────────────────────

export type TaxpayerKind = 'PM' | 'PP'

/**
 * Personne morale ou physique d'après la catégorie du matricule fiscal (1234567A/A/M/000) :
 * M = personne morale, P/C/N = personne physique, E = établissement secondaire (rattaché à une PM).
 * null quand le matricule ne la donne pas.
 */
export function taxpayerKind(matriculeFiscal: string | null | undefined): TaxpayerKind | null {
  const m = String(matriculeFiscal ?? '').toUpperCase().replace(/[\s/.\-]/g, '')
  const match = m.match(/^\d{7}[A-Z]([A-Z])([A-Z])\d{3}$/)
  if (!match) return null
  const cat = match[2]
  if (cat === 'M' || cat === 'E') return 'PM'
  if (cat === 'P' || cat === 'C' || cat === 'N') return 'PP'
  return null
}

/**
 * Date limite de la déclaration mensuelle de la période (year, month 1..12) : le 15 (PP), le 20 (PM en
 * télédéclaration, cas par défaut) ou le 28 (PM déclarant sur papier) du mois suivant, reportée au lundi
 * si elle tombe un dimanche. Un contribuable de nature inconnue prend le 15, l'échéance la plus prudente.
 */
export function monthlyDeclarationDeadline(
  year: number, month: number, kind: TaxpayerKind | null, opts: { eFiling?: boolean } = {},
): Date {
  const day = kind === 'PM' ? (opts.eFiling === false ? 28 : 20) : 15
  const d = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, day))
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1)
  return d
}

/** Période à déclarer « maintenant » : le mois précédent. */
export function previousPeriod(now: Date = new Date()): { year: number; month: number } {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1
  return m === 1 ? { year: y - 1, month: 12 } : { year: y, month: m - 1 }
}

export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate())
  return Math.round((b - a) / 86_400_000)
}

// ─── Indicateurs par dossier ─────────────────────────────────────────────────

const r3 = (n: number) => Math.round(n * 1000) / 1000
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v))

export type SaleRow = { type?: string | null; status?: string | null; subtotalHT: unknown; totalVAT: unknown; totalTTC: unknown }
export type PurchaseRow = { status?: string | null; subtotal: unknown; taxAmount: unknown; total: unknown }
export type RsRow = { taxAmount: unknown; beneficiaryTin?: string | null; beneficiaryAddress?: string | null; beneficiaryEmail?: string | null; beneficiaryPhone?: string | null; paymentDate?: Date | string | null; tejStatus?: string | null }

export type PeriodFigures = {
  salesCount: number
  salesHT: number
  vatCollected: number
  purchasesCount: number
  purchasesHT: number
  vatDeductible: number
  /** TVA collectée − déductible (négatif = crédit de TVA) */
  vatNet: number
  rsCount: number
  rsAmount: number
  /** Certificats RS auxquels il manque une donnée exigée par le fichier TEJ */
  rsIncomplete: number
}

const SALE_EXCLUDED = new Set(['DRAFT', 'CANCELLED', 'REJECTED'])
const SALE_TYPES = new Set(['INVOICE', 'INVOICE_HONORARY', 'INVOICE_SERVICE', 'CREDIT_NOTE'])

/** Agrège les pièces d'une période. Les avoirs viennent en déduction ; brouillons et annulées sont ignorés. */
export function periodFigures(sales: SaleRow[], purchases: PurchaseRow[], rs: RsRow[]): PeriodFigures {
  let salesCount = 0, salesHT = 0, vatCollected = 0
  for (const s of sales) {
    if (SALE_EXCLUDED.has(String(s.status ?? ''))) continue
    const t = String(s.type ?? 'INVOICE')
    if (!SALE_TYPES.has(t)) continue
    const sign = t === 'CREDIT_NOTE' ? -1 : 1
    if (sign > 0) salesCount++
    salesHT += sign * num(s.subtotalHT)
    vatCollected += sign * num(s.totalVAT)
  }
  let purchasesCount = 0, purchasesHT = 0, vatDeductible = 0
  for (const p of purchases) {
    if (p.status === 'CANCELLED' || p.status === 'DRAFT') continue
    purchasesCount++
    purchasesHT += num(p.subtotal)
    vatDeductible += num(p.taxAmount)
  }
  let rsAmount = 0, rsIncomplete = 0
  for (const r of rs) {
    rsAmount += num(r.taxAmount)
    if (!rsCertificateComplete(r)) rsIncomplete++
  }
  return {
    salesCount, salesHT: r3(salesHT), vatCollected: r3(vatCollected),
    purchasesCount, purchasesHT: r3(purchasesHT), vatDeductible: r3(vatDeductible),
    vatNet: r3(vatCollected - vatDeductible),
    rsCount: rs.length, rsAmount: r3(rsAmount), rsIncomplete,
  }
}

/** Mêmes exigences que l'export TEJ (identifiant, adresse, e-mail, téléphone, date de paiement). */
export function rsCertificateComplete(r: RsRow): boolean {
  return !!(r.beneficiaryTin && r.beneficiaryAddress && r.beneficiaryEmail && r.beneficiaryPhone && r.paymentDate)
}

export type ClientAlert = {
  code: 'DECLARATION_DUE' | 'DECLARATION_LATE' | 'SCANS_TO_REVIEW' | 'RS_INCOMPLETE' | 'NO_MF' | 'VAT_CREDIT'
  level: 'info' | 'warning' | 'danger'
  /** Valeurs pour le message (jours restants, nombre de pièces…) */
  value?: number
}

export type ClientSnapshotInput = {
  matriculeFiscal: string | null
  previous: PeriodFigures
  scansToReview: number
  /** La déclaration de la période précédente a-t-elle été marquée déposée ? (inconnu = false) */
  declarationFiled?: boolean
  now?: Date
}

/** Alertes d'un dossier, de la plus urgente à la moins urgente. */
export function clientAlerts(i: ClientSnapshotInput): { alerts: ClientAlert[]; deadline: string; daysLeft: number } {
  const now = i.now ?? new Date()
  const { year, month } = previousPeriod(now)
  const deadline = monthlyDeclarationDeadline(year, month, taxpayerKind(i.matriculeFiscal))
  const daysLeft = daysBetween(now, deadline)
  const alerts: ClientAlert[] = []
  if (!i.declarationFiled) {
    if (daysLeft < 0) alerts.push({ code: 'DECLARATION_LATE', level: 'danger', value: -daysLeft })
    else if (daysLeft <= 7) alerts.push({ code: 'DECLARATION_DUE', level: daysLeft <= 3 ? 'danger' : 'warning', value: daysLeft })
  }
  if (i.previous.rsIncomplete > 0) alerts.push({ code: 'RS_INCOMPLETE', level: 'warning', value: i.previous.rsIncomplete })
  if (i.scansToReview > 0) alerts.push({ code: 'SCANS_TO_REVIEW', level: 'info', value: i.scansToReview })
  if (!i.matriculeFiscal) alerts.push({ code: 'NO_MF', level: 'warning' })
  if (i.previous.vatNet < 0) alerts.push({ code: 'VAT_CREDIT', level: 'info', value: -i.previous.vatNet })
  const rank = { danger: 0, warning: 1, info: 2 }
  alerts.sort((a, b) => rank[a.level] - rank[b.level])
  return { alerts, deadline: deadline.toISOString().slice(0, 10), daysLeft }
}

/** Ordre du tableau de bord : dossiers en retard, puis échéance proche, puis pièces à traiter. */
export function clientPriority(a: { alerts: ClientAlert[] }): number {
  let p = 0
  for (const al of a.alerts) p += al.level === 'danger' ? 100 : al.level === 'warning' ? 10 : 1
  return p
}

// ─── Exports CSV (Excel français : « ; », virgule décimale, BOM UTF-8) ─────────

const BOM = '\uFEFF'

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  // Neutralise les formules (=, +, -, @) quand le champ est du texte libre
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

export function csvAmount(v: unknown): string {
  return r3(num(v)).toFixed(3).replace('.', ',')
}

export function csvDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return ''
  const dd = String(x.getUTCDate()).padStart(2, '0'), mm = String(x.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${x.getUTCFullYear()}`
}

function toCsv(header: string[], rows: unknown[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n'
}

export type JournalExportEntry = {
  date: Date | string
  entryNumber: string
  reference?: string | null
  description: string
  journal: { code: string }
  lines: Array<{ debit: unknown; credit: unknown; description?: string | null; account: { accountNumber: string; name: string } }>
}

/** Journal général, une ligne par mouvement (format d'import courant des logiciels comptables). */
export function journalToCsv(entries: JournalExportEntry[]): string {
  const rows: unknown[][] = []
  for (const e of entries) {
    for (const l of e.lines) {
      rows.push([
        csvDate(e.date), e.journal.code, e.entryNumber, e.reference ?? '', l.account.accountNumber, l.account.name,
        l.description || e.description, csvAmount(l.debit), csvAmount(l.credit),
      ])
    }
  }
  return toCsv(['Date', 'Journal', 'N° écriture', 'Pièce', 'Compte', 'Intitulé compte', 'Libellé', 'Débit', 'Crédit'], rows)
}

export type RegisterRow = {
  kind: 'VENTE' | 'ACHAT'
  date: Date | string
  number: string
  partyName: string
  partyMf?: string | null
  ht: unknown
  fodec?: unknown
  vat: unknown
  stamp?: unknown
  ttc: unknown
  rs?: unknown
  status?: string | null
}

/** Registre des factures de vente et d'achat de la période (pour un cabinet dont le client ne tient pas sa compta ici). */
export function registerToCsv(rows: RegisterRow[]): string {
  const sorted = [...rows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.number.localeCompare(b.number))
  return toCsv(
    ['Type', 'Date', 'N° pièce', 'Tiers', 'Matricule fiscal', 'Total HT', 'FODEC', 'TVA', 'Timbre', 'Total TTC', 'Retenue à la source', 'Statut'],
    sorted.map((r) => [r.kind, csvDate(r.date), r.number, r.partyName, r.partyMf ?? '', csvAmount(r.ht), csvAmount(r.fodec), csvAmount(r.vat), csvAmount(r.stamp), csvAmount(r.ttc), csvAmount(r.rs), r.status ?? '']),
  )
}

/** Bornes UTC d'un mois (1..12). */
export function monthRange(year: number, month: number): { gte: Date; lt: Date } {
  return { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1)) }
}
