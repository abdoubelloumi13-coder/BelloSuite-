/**
 * Déclaration mensuelle de TVA (Tunisie) — calcul pur à partir des documents de la période :
 * TVA collectée par taux (factures de vente, avoirs déduits), TVA déductible (factures fournisseurs),
 * FODEC (1 %) et droit de timbre collectés, TVA due ou crédit de TVA (report du crédit antérieur possible).
 */
export interface VatSaleDoc {
  type: string
  totalFodec: unknown
  totalVAT: unknown
  timbreFiscal: unknown
  subtotalHT: unknown
  items: Array<{ vatRate: unknown; vatAmount: unknown; totalHT: unknown; fodecAmount: unknown }>
}
export interface VatPurchaseDoc { subtotal: unknown; taxAmount: unknown; total: unknown }

export interface VatRateLine { rate: number; base: number; vat: number }
export interface VatDeclaration {
  month: number
  year: number
  collected: { byRate: VatRateLine[]; total: number; base: number }
  deductible: { total: number; base: number; documents: number }
  fodec: number
  stamp: number
  previousCredit: number
  vatDue: number
  vatCredit: number
  totalToPay: number
  status: 'TO_PAY' | 'CREDIT' | 'NIL'
  salesDocuments: number
  creditNotes: number
}

export const SALES_VAT_TYPES = ['INVOICE', 'CREDIT_NOTE'] as const
/** Statuts exclus de la déclaration (pièces non émises ou annulées). */
export const EXCLUDED_SALE_STATUSES = ['DRAFT', 'CANCELLED', 'REJECTED'] as const

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const r3 = (x: number) => Math.round(x * 1000) / 1000

export function computeVatDeclaration(input: {
  month: number
  year: number
  sales: VatSaleDoc[]
  purchases: VatPurchaseDoc[]
  previousCredit?: number
}): VatDeclaration {
  const byRate = new Map<number, VatRateLine>()
  let fodec = 0
  let stamp = 0
  let creditNotes = 0
  for (const doc of input.sales) {
    const sign = doc.type === 'CREDIT_NOTE' ? -1 : 1
    if (sign < 0) creditNotes++
    fodec += sign * n(doc.totalFodec)
    // le timbre n'est pas restitué sur un avoir
    if (sign > 0) stamp += n(doc.timbreFiscal)
    const items = doc.items ?? []
    const itemsVat = items.reduce((s, it) => s + n(it.vatAmount), 0)
    if (items.length && (itemsVat > 0 || n(doc.totalVAT) === 0)) {
      for (const it of items) {
        const rate = n(it.vatRate)
        const line = byRate.get(rate) ?? { rate, base: 0, vat: 0 }
        // assiette TVA = HT + FODEC (art. 6 Code TVA)
        line.base += sign * (n(it.totalHT) + n(it.fodecAmount))
        line.vat += sign * n(it.vatAmount)
        byRate.set(rate, line)
      }
    } else if (n(doc.totalVAT) !== 0) {
      // lignes sans montant de TVA (anciens documents) : rattachées au taux normal
      const line = byRate.get(19) ?? { rate: 19, base: 0, vat: 0 }
      line.base += sign * (n(doc.subtotalHT) + n(doc.totalFodec))
      line.vat += sign * n(doc.totalVAT)
      byRate.set(19, line)
    }
  }
  const rates = [...byRate.values()]
    .map(l => ({ rate: l.rate, base: r3(l.base), vat: r3(l.vat) }))
    .filter(l => l.base !== 0 || l.vat !== 0)
    .sort((a, b) => b.rate - a.rate)
  const collected = r3(rates.reduce((s, l) => s + l.vat, 0))
  const collectedBase = r3(rates.reduce((s, l) => s + l.base, 0))
  const deductible = r3(input.purchases.reduce((s, p) => s + n(p.taxAmount), 0))
  const deductibleBase = r3(input.purchases.reduce((s, p) => s + n(p.subtotal), 0))
  const previousCredit = r3(Math.max(0, n(input.previousCredit)))
  const net = r3(collected - deductible - previousCredit)
  const vatDue = net > 0 ? net : 0
  const vatCredit = net < 0 ? r3(-net) : 0
  fodec = r3(fodec)
  stamp = r3(stamp)
  const totalToPay = r3(vatDue + Math.max(0, fodec) + stamp)
  return {
    month: input.month,
    year: input.year,
    collected: { byRate: rates, total: collected, base: collectedBase },
    deductible: { total: deductible, base: deductibleBase, documents: input.purchases.length },
    fodec,
    stamp,
    previousCredit,
    vatDue,
    vatCredit,
    totalToPay,
    status: vatDue > 0 ? 'TO_PAY' : vatCredit > 0 ? 'CREDIT' : 'NIL',
    salesDocuments: input.sales.length - creditNotes,
    creditNotes,
  }
}

/** Bornes [début, fin] d'un mois (heure locale du serveur). */
export function monthRange(month: number, year: number) {
  return { start: new Date(year, month - 1, 1), end: new Date(year, month, 0, 23, 59, 59, 999) }
}
