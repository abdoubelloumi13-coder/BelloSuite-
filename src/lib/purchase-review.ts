/**
 * Scan IA des factures d'achat — contrôle avant saisie (logique PURE, testée dans __tests__/purchase-review.test.ts).
 *
 * À partir de l'extraction (invoice-extract / ai-invoice) :
 *  1. matricule fiscal du fournisseur : format, différent de celui de l'entreprise ;
 *  2. doublons : même fournisseur + même n° de pièce, ou même fournisseur + même date + même TTC ;
 *  3. contrôles arithmétiques déjà calculés par l'extraction (HT + FODEC + TVA + timbre = TTC, TVA = base × taux) ;
 *  4. retenue à la source à opérer au paiement (acquisitions ≥ 1 000 DT TTC, art. 52 Code IRPP/IS) ;
 *  5. écriture comptable proposée au journal des achats (plan comptable tunisien : 607/604, 4366, 665, 401)
 *     et écriture de règlement avec la retenue (401 / 532, 432).
 * Rien n'est enregistré ici : la saisie reste validée par l'utilisateur.
 */
import type { InvoiceExtraction } from '@/lib/invoice-extract'
import {
  ACQUISITION_THRESHOLD_TTC, getRSRule, isValidMatriculeFiscal, tejMatricule,
  type BeneficiaryRegime, type BeneficiaryType,
} from '@/lib/retenue-source'
import { taxpayerKind } from '@/lib/firm-logic'
import { TN_ACCOUNTS } from '@/lib/tunisian-chart-of-accounts'

const r3 = (n: number) => Math.round(n * 1000) / 1000

export type ExistingPurchase = { id: string; number: string; supplierId: string | null; supplierRef: string | null; date: Date | string; total: unknown }
export type ReviewSupplier = { id: string; name: string; matriculeFiscal: string | null; regime?: BeneficiaryRegime | null; type?: BeneficiaryType | null }

export type ReviewIssue = {
  code:
    | 'MF_MISSING' | 'MF_INVALID' | 'MF_IS_OWN' | 'DUPLICATE_REF' | 'DUPLICATE_AMOUNT'
    | 'TOTALS_MISMATCH' | 'VAT_MISMATCH' | 'LINES_MISMATCH' | 'NO_DATE' | 'NO_REF' | 'NEW_SUPPLIER'
    | 'STAMP_MISSING' | 'RS_REGIME_ASSUMED' | 'FUTURE_DATE'
  level: 'blocking' | 'warning' | 'info'
  ref?: string
}

export type EntryLine = { account: string; label: string; debit: number; credit: number }

export type PurchaseReview = {
  status: 'READY' | 'TO_CHECK' | 'BLOCKED'
  issues: ReviewIssue[]
  supplier: { matchedId: string | null; mf: string | null; mfValid: boolean }
  duplicates: Array<{ id: string; number: string; reason: 'REF' | 'AMOUNT' }>
  amounts: { ht: number; fodec: number; vat: number; stamp: number; ttc: number }
  rs: { applies: boolean; rate: number; amount: number; tejCode: string | null; netToPay: number; label: string; assumedRegime: boolean }
  entry: { journal: 'ACH'; lines: EntryLine[]; balanced: boolean }
  payment: { journal: 'BQ'; lines: EntryLine[] }
}

function normRef(s: string | null | undefined): string {
  return String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '')
}
function mfKey(s: string | null | undefined): string | null { return tejMatricule(s) }
function sameDay(a: Date | string, b: Date | string): boolean {
  const x = new Date(a), y = new Date(b)
  return !Number.isNaN(x.getTime()) && !Number.isNaN(y.getTime()) && x.toISOString().slice(0, 10) === y.toISOString().slice(0, 10)
}

/** Charges de services (honoraires, maintenance, transport…) → 604 ; sinon achats de marchandises 607. */
const SERVICE_HINT = /\b(prestation|service|maintenance|honoraires?|conseil|formation|transport|location|abonnement|réparation|reparation|installation|main d.?oeuvre|audit|étude|etude)\b/i

export function purchaseAccount(x: Pick<InvoiceExtraction, 'lines' | 'supplierName'>): { account: '607' | '604'; label: string } {
  const text = [x.supplierName.value, ...x.lines.map((l) => l.designation)].filter(Boolean).join(' ')
  return SERVICE_HINT.test(text)
    ? { account: '604', label: 'Achats d’études et de prestations de services' }
    : { account: '607', label: 'Achats de marchandises' }
}

/**
 * Régime RS du fournisseur : celui de la fiche s'il est renseigné, sinon déduit du matricule
 * (personne morale → IS 20 %, sinon personne physique au réel) et signalé comme supposé.
 */
export function supplierRsProfile(s: Pick<ReviewSupplier, 'regime' | 'type'> | null, mf: string | null): { type: BeneficiaryType; regime: BeneficiaryRegime; assumed: boolean } {
  if (s?.regime) return { type: s.type ?? (s.regime === 'IS_20' || s.regime === 'IS_10' ? 'SOCIETE' : 'INDIVIDU'), regime: s.regime, assumed: false }
  const kind = taxpayerKind(mf)
  if (kind === 'PM') return { type: 'SOCIETE', regime: 'IS_20', assumed: true }
  return { type: 'INDIVIDU', regime: 'STANDARD', assumed: true }
}

export type ReviewInput = {
  extraction: InvoiceExtraction
  matchedSupplier: ReviewSupplier | null
  existing: ExistingPurchase[]
  ownMatriculeFiscal?: string | null
  now?: Date
}

export function reviewPurchase(i: ReviewInput): PurchaseReview {
  const x = i.extraction
  const issues: ReviewIssue[] = []
  const now = i.now ?? new Date()

  // 1. Fournisseur / matricule
  const mf = x.matriculeFiscal.value ?? i.matchedSupplier?.matriculeFiscal ?? null
  const mfValid = !!mf && isValidMatriculeFiscal(mf)
  if (!mf) issues.push({ code: 'MF_MISSING', level: 'warning' })
  else if (!mfValid) issues.push({ code: 'MF_INVALID', level: 'warning' })
  if (mf && i.ownMatriculeFiscal && mfKey(mf) && mfKey(mf) === mfKey(i.ownMatriculeFiscal)) issues.push({ code: 'MF_IS_OWN', level: 'blocking' })
  if (!i.matchedSupplier) issues.push({ code: 'NEW_SUPPLIER', level: 'info' })

  // 2. Doublons
  const ref = normRef(x.invoiceNumber.value)
  const ttcRead = x.total.value
  const duplicates: PurchaseReview['duplicates'] = []
  if (i.matchedSupplier) {
    for (const p of i.existing) {
      if (p.supplierId !== i.matchedSupplier.id) continue
      if (ref && normRef(p.supplierRef) === ref) { duplicates.push({ id: p.id, number: p.number, reason: 'REF' }); continue }
      if (ttcRead !== null && x.date.value && sameDay(p.date, x.date.value) && Math.abs(Number(p.total) - ttcRead) < 0.0015) {
        duplicates.push({ id: p.id, number: p.number, reason: 'AMOUNT' })
      }
    }
  }
  for (const d of duplicates) issues.push({ code: d.reason === 'REF' ? 'DUPLICATE_REF' : 'DUPLICATE_AMOUNT', level: d.reason === 'REF' ? 'blocking' : 'warning', ref: d.number })

  // 3. Contrôles de l'extraction
  if (x.checks.totalsConsistent === false) issues.push({ code: 'TOTALS_MISMATCH', level: 'warning' })
  if (x.checks.vatConsistent === false) issues.push({ code: 'VAT_MISMATCH', level: 'warning' })
  if (x.checks.linesMatchSubtotal === false) issues.push({ code: 'LINES_MISMATCH', level: 'info' })
  if (!x.date.value) issues.push({ code: 'NO_DATE', level: 'warning' })
  else if (new Date(x.date.value).getTime() > now.getTime() + 86_400_000) issues.push({ code: 'FUTURE_DATE', level: 'warning' })
  if (!x.invoiceNumber.value) issues.push({ code: 'NO_REF', level: 'warning' })

  const ht = r3(x.subtotal.value ?? 0)
  const fodec = r3(x.fodec.value ?? 0)
  const vat = r3(x.vatTotal.value ?? x.vat.reduce((s, v) => s + v.amount, 0))
  const stamp = r3(x.stamp.value ?? 0)
  const ttc = r3(ttcRead ?? ht + fodec + vat + stamp)
  if (!x.stamp.value) issues.push({ code: 'STAMP_MISSING', level: 'info' })

  // 4. Retenue à la source au paiement
  const profile = supplierRsProfile(i.matchedSupplier, mf)
  const rule = getRSRule('PRESTATION_SERVICE', profile.type, profile.regime, ttc)
  const applies = ttc >= ACQUISITION_THRESHOLD_TTC && rule.taux > 0
  const rsAmount = applies ? r3(ttc * rule.taux) : 0
  if (applies && profile.assumed) issues.push({ code: 'RS_REGIME_ASSUMED', level: 'info' })

  // 5. Écritures proposées
  const acc = purchaseAccount(x)
  const supplierLabel = x.supplierName.value ?? 'Fournisseur'
  const pieceLabel = [supplierLabel, x.invoiceNumber.value].filter(Boolean).join(' — ')
  const lines: EntryLine[] = [
    { account: acc.account, label: `${acc.label} — ${pieceLabel}`, debit: r3(ht + fodec), credit: 0 },
  ]
  if (vat) lines.push({ account: TN_ACCOUNTS.VAT_DEDUCTIBLE, label: `TVA déductible — ${pieceLabel}`, debit: vat, credit: 0 })
  if (stamp) lines.push({ account: TN_ACCOUNTS.STAMP_EXPENSE, label: `Timbre fiscal — ${pieceLabel}`, debit: stamp, credit: 0 })
  const debits = r3(lines.reduce((s, l) => s + l.debit, 0))
  // Écart d'arrondi éventuel (TTC lu ≠ somme) : absorbé seulement s'il est d'au plus 5 millimes, sinon signalé
  const gap = r3(ttc - debits)
  if (Math.abs(gap) > 0 && Math.abs(gap) <= 0.005) lines[0].debit = r3(lines[0].debit + gap)
  lines.push({ account: TN_ACCOUNTS.SUPPLIERS, label: `Fournisseurs — ${pieceLabel}`, debit: 0, credit: ttc })
  const totalD = r3(lines.reduce((s, l) => s + l.debit, 0)), totalC = r3(lines.reduce((s, l) => s + l.credit, 0))
  const balanced = Math.abs(totalD - totalC) < 0.0005
  if (!balanced && !issues.some((is) => is.code === 'TOTALS_MISMATCH')) issues.push({ code: 'TOTALS_MISMATCH', level: 'warning' })

  const payment: EntryLine[] = [
    { account: TN_ACCOUNTS.SUPPLIERS, label: `Règlement — ${pieceLabel}`, debit: ttc, credit: 0 },
    { account: TN_ACCOUNTS.BANK, label: `Banque — ${pieceLabel}`, debit: 0, credit: r3(ttc - rsAmount) },
  ]
  if (rsAmount) payment.push({ account: TN_ACCOUNTS.WITHHOLDING, label: `Retenue à la source ${(rule.taux * 100).toLocaleString('fr-FR')} % — ${pieceLabel}`, debit: 0, credit: rsAmount })

  const status: PurchaseReview['status'] = issues.some((is) => is.level === 'blocking') ? 'BLOCKED'
    : issues.some((is) => is.level === 'warning') ? 'TO_CHECK' : 'READY'

  return {
    status, issues,
    supplier: { matchedId: i.matchedSupplier?.id ?? null, mf, mfValid },
    duplicates,
    amounts: { ht, fodec, vat, stamp, ttc },
    rs: { applies, rate: applies ? rule.taux : 0, amount: rsAmount, tejCode: applies ? rule.tejCode : null, netToPay: r3(ttc - rsAmount), label: applies ? rule.label : rule.label, assumedRegime: applies && profile.assumed },
    entry: { journal: 'ACH', lines, balanced },
    payment: { journal: 'BQ', lines: payment },
  }
}
