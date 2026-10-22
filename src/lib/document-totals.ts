/**
 * Recalcul serveur des montants d'un document commercial (facture, devis, BC, BL, avoir).
 * Le serveur ne fait JAMAIS confiance aux totaux envoyés par le client : seuls quantité, prix
 * unitaire HT, remise, taux de TVA et FODEC sont repris, tout le reste est recalculé
 * (lib/fiscal, arrondi au millime).
 *
 * Timbre fiscal (1,000 DT) : uniquement sur les factures, par défaut. Devis, bons de commande,
 * bons de livraison et avoirs n'en portent pas, sauf demande explicite (applyTimbre: true).
 */
import { calculateInvoiceTotals, calculateLine, VAT_RATES, type InvoiceTotals } from '@/lib/fiscal'

export type RawDocumentItem = {
  productId?: string | null
  description?: unknown
  unit?: unknown
  quantity?: unknown
  unitPriceHT?: unknown
  discount?: unknown
  vatRate?: unknown
  fodecApply?: unknown
}

export type ComputedDocumentItem = {
  productId: string | null
  description: string
  unit: string
  quantity: number
  unitPriceHT: number
  discount: number
  fodecApply: boolean
  fodecAmount: number
  vatRate: number
  vatAmount: number
  totalHT: number
  totalTTC: number
}

export class DocumentTotalsError extends Error {
  constructor(message: string, public field?: string) { super(message) }
}

/** Types de document portant le droit de timbre par défaut. */
export const STAMPED_TYPES = ['INVOICE', 'INVOICE_SERVICE', 'INVOICE_HONORARY']

export function defaultApplyStamp(type: string): boolean {
  return STAMPED_TYPES.includes(type)
}

/**
 * Timbre appliqué ? `applyTimbre` explicite (booléen) prioritaire ; sinon `timbreFiscal` envoyé à 0
 * (ancienne case décochée) → pas de timbre ; sinon défaut du type.
 */
export function resolveApplyStamp(type: string, body: { applyTimbre?: unknown; timbreFiscal?: unknown } = {}): boolean {
  if (typeof body.applyTimbre === 'boolean') return body.applyTimbre
  if (!defaultApplyStamp(type)) return false
  if (body.timbreFiscal !== undefined && body.timbreFiscal !== null && body.timbreFiscal !== '' && Number(body.timbreFiscal) === 0) return false
  return true
}

const num = (v: unknown, def = 0) => {
  if (v === '' || v === null || v === undefined) return def
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

export function computeDocumentTotals(
  rawItems: RawDocumentItem[],
  opts: { applyStamp: boolean },
): { items: ComputedDocumentItem[]; totals: InvoiceTotals } {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new DocumentTotalsError('Au moins une ligne est requise', 'items')
  const items: ComputedDocumentItem[] = rawItems.map((it, i) => {
    const quantity = num(it?.quantity, NaN)
    const unitPriceHT = num(it?.unitPriceHT, 0)
    const discount = num(it?.discount, 0)
    const vatRate = num(it?.vatRate, 19)
    if (!Number.isFinite(quantity) || quantity < 0) throw new DocumentTotalsError(`Ligne ${i + 1} : quantité invalide`, `items.${i}.quantity`)
    if (!Number.isFinite(unitPriceHT) || unitPriceHT < 0) throw new DocumentTotalsError(`Ligne ${i + 1} : prix unitaire invalide`, `items.${i}.unitPriceHT`)
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) throw new DocumentTotalsError(`Ligne ${i + 1} : remise invalide (0 à 100 %)`, `items.${i}.discount`)
    if (!VAT_RATES.includes(vatRate)) throw new DocumentTotalsError(`Ligne ${i + 1} : taux de TVA non autorisé (${VAT_RATES.join(', ')} %)`, `items.${i}.vatRate`)
    const fodecApply = it?.fodecApply === true || it?.fodecApply === 'true'
    const c = calculateLine({ quantity, unitPriceHT, discount, vatRate, fodecApply })
    return {
      productId: typeof it?.productId === 'string' && it.productId ? it.productId : null,
      description: String(it?.description ?? '').trim(),
      unit: String(it?.unit ?? 'EA').slice(0, 8) || 'EA',
      quantity,
      unitPriceHT,
      discount,
      fodecApply,
      fodecAmount: c.fodecAmount,
      vatRate,
      vatAmount: c.vatAmount,
      totalHT: c.totalHT,
      totalTTC: c.totalTTC,
    }
  })
  const totals = calculateInvoiceTotals(
    items.map(i => ({ quantity: i.quantity, unitPriceHT: i.unitPriceHT, discount: i.discount, vatRate: i.vatRate, fodecApply: i.fodecApply })),
    { applyStamp: opts.applyStamp },
  )
  return { items, totals }
}

/** Au moins une ligne à 0 % de TVA ? (une mention légale d'exonération / suspension est alors requise). */
export function hasZeroRatedLine(items: Array<{ vatRate: number }>): boolean {
  return items.some(i => Number(i.vatRate) === 0)
}
