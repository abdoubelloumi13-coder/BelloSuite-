/**
 * Point de vente — logique métier pure (testée dans __tests__/pos-logic.test.ts).
 *
 * Règles :
 * - Remise globale (%) appliquée sur le HT de chaque ligne, puis TVA calculée sur le HT remisé
 *   (la TVA n'est jamais calculée sur un montant avant remise).
 * - Timbre fiscal : uniquement si la caisse est configurée pour l'appliquer (défaut : non) ET si le
 *   panier n'est pas vide.
 * - Arrondi au millime (3 décimales).
 * - Fermeture : espèces attendues = fond de caisse + encaissements espèces − monnaie rendue.
 */

export const POS_STAMP_AMOUNT = 1

export function round3(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 1000) / 1000
}

export type PosLineInput = {
  quantity: number
  unitPriceHT: number
  vatRate: number
  /** Remise de ligne en % (0-100) */
  discount?: number
}

export type PosLineTotals = { grossHT: number; discountAmount: number; totalHT: number; vatAmount: number; totalTTC: number }

export type PosTotals = {
  lines: PosLineTotals[]
  grossHT: number
  discountAmount: number
  subtotalHT: number
  totalVAT: number
  timbreFiscal: number
  totalTTC: number
  vatByRate: Array<{ rate: number; base: number; vat: number }>
}

export type PosSettings = { applyStamp: boolean; stampAmount: number }

export const DEFAULT_POS_SETTINGS: PosSettings = { applyStamp: false, stampAmount: POS_STAMP_AMOUNT }

/** Lit les réglages caisse depuis Tenant.settings (JSON libre) : { pos: { applyStamp, stampAmount } }. */
export function readPosSettings(tenantSettings: unknown): PosSettings {
  const pos = (tenantSettings && typeof tenantSettings === 'object' ? (tenantSettings as Record<string, unknown>).pos : null) as Record<string, unknown> | null
  const applyStamp = pos?.applyStamp === true
  const amt = Number(pos?.stampAmount)
  return { applyStamp, stampAmount: Number.isFinite(amt) && amt >= 0 ? round3(amt) : POS_STAMP_AMOUNT }
}

const clampPct = (p: unknown) => Math.min(100, Math.max(0, Number(p) || 0))

export function computePosTotals(items: PosLineInput[], opts: { discountPercent?: number; applyStamp?: boolean; stampAmount?: number } = {}): PosTotals {
  const globalPct = clampPct(opts.discountPercent)
  const byRate = new Map<number, { base: number; vat: number }>()
  const lines = items.map((it) => {
    const qty = Number(it.quantity) || 0
    const pu = Number(it.unitPriceHT) || 0
    const rate = Number(it.vatRate) || 0
    const grossHT = round3(qty * pu)
    const afterLine = grossHT * (1 - clampPct(it.discount) / 100)
    const totalHT = round3(afterLine * (1 - globalPct / 100))
    const discountAmount = round3(grossHT - totalHT)
    const vatAmount = round3(totalHT * rate / 100)
    const agg = byRate.get(rate) || { base: 0, vat: 0 }
    agg.base += totalHT; agg.vat += vatAmount
    byRate.set(rate, agg)
    return { grossHT, discountAmount, totalHT, vatAmount, totalTTC: round3(totalHT + vatAmount) }
  })
  const sum = (k: keyof PosLineTotals) => round3(lines.reduce((s, l) => s + l[k], 0))
  const nonEmpty = lines.some((l) => l.grossHT > 0 || l.totalHT > 0) && items.length > 0
  const timbreFiscal = opts.applyStamp && nonEmpty ? round3(opts.stampAmount ?? POS_STAMP_AMOUNT) : 0
  const subtotalHT = sum('totalHT')
  const totalVAT = sum('vatAmount')
  return {
    lines,
    grossHT: sum('grossHT'),
    discountAmount: sum('discountAmount'),
    subtotalHT,
    totalVAT,
    timbreFiscal,
    totalTTC: round3(subtotalHT + totalVAT + timbreFiscal),
    vatByRate: [...byRate.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, base: round3(v.base), vat: round3(v.vat) })),
  }
}

export type PosPaymentInput = { method: string; amount: number }

/**
 * Répartit les paiements : la monnaie n'est rendue que sur les espèces.
 * Renvoie l'encaissé total, la monnaie rendue et si le ticket est soldé.
 */
export function settlePayments(totalTTC: number, payments: PosPaymentInput[]) {
  const paid = round3(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0))
  const nonCash = round3(payments.filter((p) => p.method !== 'CASH').reduce((s, p) => s + (Number(p.amount) || 0), 0))
  const cash = round3(paid - nonCash)
  const overpay = round3(paid - totalTTC)
  // La monnaie ne peut être rendue que dans la limite des espèces versées
  const changeGiven = overpay > 0 ? round3(Math.min(overpay, cash)) : 0
  return { paidAmount: paid, cashReceived: cash, changeGiven, isPaid: paid + 0.0005 >= totalTTC }
}

/** Numéro de ticket lisible et quasi unique : T-AAAAMMJJ-HHMMSS-XXX */
export function makeOrderNumber(d: Date = new Date(), rand: () => number = Math.random): string {
  const p = (n: number, l = 2) => String(n).padStart(l, '0')
  const suffix = Math.floor(rand() * 46656).toString(36).toUpperCase().padStart(3, '0')
  return `T-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${suffix}`
}

export type ZOrder = {
  status?: string | null
  subtotalHT: unknown; totalVAT: unknown; timbreFiscal: unknown; totalTTC: unknown
  discountAmount?: unknown; changeGiven?: unknown
  items?: Array<{ vatRate: unknown; totalHT: unknown; vatAmount: unknown }>
  payments?: Array<{ method: string; amount: unknown }>
}

export type ZReport = {
  ordersCount: number
  cancelledCount: number
  totalHT: number
  totalVAT: number
  totalStamp: number
  totalTTC: number
  totalDiscount: number
  averageTicket: number
  vatByRate: Array<{ rate: number; base: number; vat: number }>
  byMethod: Array<{ method: string; amount: number }>
  openingCash: number
  cashIn: number
  changeGiven: number
  expectedCash: number
  countedCash: number | null
  cashDifference: number | null
}

/** Rapport Z (clôture de caisse) à partir des tickets de la session. */
export function buildZReport(openingCash: number, orders: ZOrder[], countedCash?: number | null): ZReport {
  const valid = orders.filter((o) => o.status !== 'CANCELLED')
  const n = (v: unknown) => Number(v) || 0
  const rates = new Map<number, { base: number; vat: number }>()
  const methods = new Map<string, number>()
  let cashIn = 0, change = 0
  for (const o of valid) {
    for (const it of o.items || []) {
      const r = n(it.vatRate); const a = rates.get(r) || { base: 0, vat: 0 }
      a.base += n(it.totalHT); a.vat += n(it.vatAmount); rates.set(r, a)
    }
    for (const p of o.payments || []) {
      methods.set(p.method, (methods.get(p.method) || 0) + n(p.amount))
      if (p.method === 'CASH') cashIn += n(p.amount)
    }
    change += n(o.changeGiven)
  }
  const totalTTC = round3(valid.reduce((s, o) => s + n(o.totalTTC), 0))
  const expectedCash = round3(n(openingCash) + cashIn - change)
  const counted = countedCash === null || countedCash === undefined || !Number.isFinite(Number(countedCash)) ? null : round3(Number(countedCash))
  return {
    ordersCount: valid.length,
    cancelledCount: orders.length - valid.length,
    totalHT: round3(valid.reduce((s, o) => s + n(o.subtotalHT), 0)),
    totalVAT: round3(valid.reduce((s, o) => s + n(o.totalVAT), 0)),
    totalStamp: round3(valid.reduce((s, o) => s + n(o.timbreFiscal), 0)),
    totalTTC,
    totalDiscount: round3(valid.reduce((s, o) => s + n(o.discountAmount), 0)),
    averageTicket: valid.length ? round3(totalTTC / valid.length) : 0,
    vatByRate: [...rates.entries()].sort((a, b) => b[0] - a[0]).map(([rate, v]) => ({ rate, base: round3(v.base), vat: round3(v.vat) })),
    byMethod: [...methods.entries()].map(([method, amount]) => ({ method, amount: round3(amount) })),
    openingCash: round3(n(openingCash)),
    cashIn: round3(cashIn),
    changeGiven: round3(change),
    expectedCash,
    countedCash: counted,
    cashDifference: counted === null ? null : round3(counted - expectedCash),
  }
}
