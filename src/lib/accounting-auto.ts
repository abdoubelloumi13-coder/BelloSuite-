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

/**
 * Calcule le montant de la RS (retenue à la source) pour une note d'honoraires
 * Taux RS = 1.5%, plafond 20% du montant total HT
 * La RS est déductible de la TTC et doit être reflétée dans l'écriture
 */
export function calculateRS(subtotalHT: number, totalRS: number): {
  taxableAmount: number
  rsAmount: number
  netToClient: number
} {
  const rsAmount = totalRS > 0 ? totalRS : subtotalHT * 0.015
  const netToClient = subtotalHT - rsAmount
  return {
    taxableAmount: subtotalHT, // Base pour la RS
    rsAmount: Math.round(rsAmount * 1000) / 1000,
    netToClient: Math.round(netToClient * 1000) / 1000,
  }
}
