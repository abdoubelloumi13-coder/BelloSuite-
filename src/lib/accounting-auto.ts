/**
 * Accounting Auto-Journalization Service
 * ======================================
 * Génère les écritures comptables des documents commerciaux selon le plan comptable tunisien (SCE) :
 *  411  : Clients
 *  707  : Ventes de marchandises      705 : Etudes et prestations de services (honoraires inclus)
 *  4367 : TVA collectée               4371 : FODEC à payer
 *  4368 : Droit de timbre collecté à reverser
 *  432  : Etat, retenues à la source (opérées au règlement, pas à la facturation)
 * Mêmes comptes que lib/purchase-review (achats : 607/604, 4366, 665, 401 ; règlement 532, 432).
 */

import { TN_ACCOUNTS } from '@/lib/tunisian-chart-of-accounts'

export type AmountField = 'totalTTC' | 'subtotalHT' | 'totalVAT' | 'timbreFiscal' | 'totalFodec'

export interface JournalizationRule {
  documentType: string
  journalCode: string
  lines: Array<{
    accountPrefix: string
    accountLabel: string
    debit: boolean
    field: AmountField
  }>
}

const saleLines = (revenueAccount: string, revenueLabel: string): JournalizationRule['lines'] => [
  { accountPrefix: TN_ACCOUNTS.CLIENTS, accountLabel: 'Clients', debit: true, field: 'totalTTC' },
  { accountPrefix: revenueAccount, accountLabel: revenueLabel, debit: false, field: 'subtotalHT' },
  { accountPrefix: TN_ACCOUNTS.FODEC, accountLabel: 'FODEC à payer', debit: false, field: 'totalFodec' },
  { accountPrefix: TN_ACCOUNTS.VAT_COLLECTED, accountLabel: 'TVA collectée', debit: false, field: 'totalVAT' },
  { accountPrefix: TN_ACCOUNTS.STAMP_COLLECTED, accountLabel: 'Droit de timbre collecté', debit: false, field: 'timbreFiscal' },
]

/**
 * Règles de journalisation par type de document
 */
export const JOURNALIZATION_RULES: Record<string, JournalizationRule> = {
  // ─── Facture de vente (marchandises) ───────────────────
  INVOICE: { documentType: 'INVOICE', journalCode: 'VT', lines: saleLines(TN_ACCOUNTS.SALES_GOODS, 'Ventes de marchandises HT') },
  // ─── Note d'honoraires : la RS éventuelle est constatée au règlement (432), pas ici ─
  INVOICE_HONORARY: { documentType: 'INVOICE_HONORARY', journalCode: 'VT', lines: saleLines(TN_ACCOUNTS.SALES_SERVICES, 'Honoraires HT') },
  // ─── Facture de service ─────────────────────────────────
  INVOICE_SERVICE: { documentType: 'INVOICE_SERVICE', journalCode: 'VT', lines: saleLines(TN_ACCOUNTS.SALES_SERVICES, 'Prestations de services HT') },
  // ─── Avoir : contrepassation (le timbre n'est pas restitué) ─
  CREDIT_NOTE: {
    documentType: 'CREDIT_NOTE',
    journalCode: 'VT',
    lines: [
      { accountPrefix: TN_ACCOUNTS.SALES_GOODS, accountLabel: 'Ventes - Annulation', debit: true, field: 'subtotalHT' },
      { accountPrefix: TN_ACCOUNTS.FODEC, accountLabel: 'FODEC - Annulation', debit: true, field: 'totalFodec' },
      { accountPrefix: TN_ACCOUNTS.VAT_COLLECTED, accountLabel: 'TVA collectée - Annulation', debit: true, field: 'totalVAT' },
      { accountPrefix: TN_ACCOUNTS.CLIENTS, accountLabel: 'Clients - Avoir', debit: false, field: 'totalTTC' },
    ],
  },
  // ─── Devis ───────────────────────────────────────────────
  QUOTE: {
    documentType: 'QUOTE',
    journalCode: 'VT',
    lines: [], // Pas d'écriture comptable pour un devis
  },
}

export type AutoEntryLine = { account: string; label: string; debit: number; credit: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000

/**
 * Lignes d'écriture d'un document selon sa règle. Lignes nulles omises ; pour un avoir le montant client est
 * recalculé (HT + FODEC + TVA) car le timbre n'est pas restitué. Un écart d'arrondi ≤ 5 millimes est absorbé
 * par la ligne de produit ; au-delà, `balanced` vaut false (à corriger avant comptabilisation).
 */
export function buildAutoEntryLines(
  doc: Partial<Record<AmountField, unknown>> & { type: string },
  rule: JournalizationRule | undefined = JOURNALIZATION_RULES[doc.type]
): { lines: AutoEntryLine[]; balanced: boolean } {
  if (!rule || rule.lines.length === 0) return { lines: [], balanced: true }
  const amount = (f: AmountField) => r3(Number(doc[f]) || 0)
  const lines: AutoEntryLine[] = []
  for (const l of rule.lines) {
    let v = amount(l.field)
    if (doc.type === 'CREDIT_NOTE' && l.field === 'totalTTC') v = r3(amount('subtotalHT') + amount('totalFodec') + amount('totalVAT'))
    if (!v) continue
    lines.push({ account: l.accountPrefix, label: l.accountLabel, debit: l.debit ? v : 0, credit: l.debit ? 0 : v })
  }
  const d = r3(lines.reduce((s, l) => s + l.debit, 0))
  const c = r3(lines.reduce((s, l) => s + l.credit, 0))
  const gap = r3(d - c)
  if (gap !== 0 && Math.abs(gap) <= 0.005) {
    const revenue = lines.find(l => l.account === TN_ACCOUNTS.SALES_GOODS || l.account === TN_ACCOUNTS.SALES_SERVICES)
    if (revenue) {
      if (revenue.credit) revenue.credit = r3(revenue.credit + gap)
      else revenue.debit = r3(revenue.debit - gap)
    }
  }
  const d2 = r3(lines.reduce((s, l) => s + l.debit, 0))
  const c2 = r3(lines.reduce((s, l) => s + l.credit, 0))
  return { lines, balanced: Math.abs(d2 - c2) < 0.0005 }
}

/**
 * Construit le libellé de l'écriture comptable
 */
export function buildEntryDescription(doc: {
  number: string
  type: string
  client?: { name: string } | null
}): string {
  const labels: Record<string, string> = {
    INVOICE: 'Facture',
    INVOICE_SERVICE: 'Facture Service',
    INVOICE_HONORARY: 'Note Honoraires',
    CREDIT_NOTE: 'Avoir',
    QUOTE: 'Devis',
    ORDER: 'Bon de commande',
    DELIVERY_NOTE: 'Bon de livraison',
  }
  const label = labels[doc.type] || doc.type
  const client = doc.client?.name ? ` - ${doc.client.name}` : ''
  return `${label} ${doc.number}${client}`
}

/** Documents de vente donnant lieu à une écriture (devis, BC et BL : aucune écriture comptable). */
export const POSTABLE_SALE_TYPES = ['INVOICE', 'INVOICE_SERVICE', 'INVOICE_HONORARY', 'CREDIT_NOTE']
/** Documents de vente pouvant être réglés (encaissement client). */
export const PAYABLE_SALE_TYPES = ['INVOICE', 'INVOICE_SERVICE', 'INVOICE_HONORARY']

export function isPostableSaleType(type: string): boolean {
  return POSTABLE_SALE_TYPES.includes(type)
}

export class SettlementError extends Error {
  constructor(message: string, public field?: string, public status = 400) { super(message) }
}

/**
 * Règlement (total ou partiel) d'une facture de vente, avec retenue à la source SUBIE éventuelle :
 *   reste dû = TTC − déjà soldé − avoirs (HT + FODEC + TVA des avoirs actifs liés)
 *   encaissement + RS subie ≤ reste dû ; par défaut l'encaissement solde le reste (net de la RS).
 * Écriture : 532|541 (encaissement) + 4341 (RS subie, créance sur l'État) / 411 (montant soldé).
 */
export function computeSettlement(input: {
  totalTTC: number
  alreadySettled: number
  credited?: number
  amount?: number | null
  rsAmount?: number | null
  method?: 'CASH' | 'BANK'
}): { remainingBefore: number; amount: number; rsAmount: number; settled: number; remainingAfter: number; fullyPaid: boolean; lines: AutoEntryLine[] } {
  const remainingBefore = r3(Number(input.totalTTC) - Number(input.alreadySettled || 0) - Number(input.credited || 0))
  if (remainingBefore <= 0.0005) throw new SettlementError('Facture déjà soldée', undefined, 409)
  const rsAmount = r3(Number(input.rsAmount) || 0)
  if (rsAmount < 0) throw new SettlementError('Retenue à la source invalide', 'rsAmount')
  const amount = input.amount === undefined || input.amount === null ? r3(remainingBefore - rsAmount) : r3(Number(input.amount))
  if (!Number.isFinite(amount) || amount < 0) throw new SettlementError('Montant du règlement invalide', 'amount')
  const settled = r3(amount + rsAmount)
  if (settled <= 0) throw new SettlementError('Montant du règlement nul', 'amount')
  if (settled > remainingBefore + 0.0005) {
    throw new SettlementError(`Règlement supérieur au reste dû (${remainingBefore.toFixed(3)} DT)`, 'amount')
  }
  const remainingAfter = r3(remainingBefore - settled)
  const treasury = input.method === 'CASH' ? TN_ACCOUNTS.CASH : TN_ACCOUNTS.BANK
  const lines: AutoEntryLine[] = []
  if (amount > 0) lines.push({ account: treasury, label: input.method === 'CASH' ? 'Encaissement caisse' : 'Encaissement banque', debit: amount, credit: 0 })
  if (rsAmount > 0) lines.push({ account: TN_ACCOUNTS.WITHHOLDING_SUFFERED, label: 'Retenue à la source subie', debit: rsAmount, credit: 0 })
  lines.push({ account: TN_ACCOUNTS.CLIENTS, label: 'Clients', debit: 0, credit: settled })
  return { remainingBefore, amount, rsAmount, settled, remainingAfter, fullyPaid: remainingAfter <= 0.0005, lines }
}
