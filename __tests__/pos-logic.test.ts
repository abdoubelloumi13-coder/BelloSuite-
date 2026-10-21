/**
 * Point de vente — totaux, timbre, paiements, rapport Z (src/lib/pos-logic.ts)
 */
import { computePosTotals, settlePayments, buildZReport, readPosSettings, makeOrderNumber } from '@/lib/pos-logic'
import { posOrderSchema } from '@/services/pos'

jest.mock('@/lib/db', () => ({ prisma: {} }))

describe('computePosTotals', () => {
  const items = [
    { quantity: 2, unitPriceHT: 10, vatRate: 19 },   // 20 HT
    { quantity: 1, unitPriceHT: 100, vatRate: 7 },   // 100 HT
  ]
  it('sans remise ni timbre (défaut)', () => {
    const t = computePosTotals(items)
    expect(t.subtotalHT).toBe(120)
    expect(t.totalVAT).toBe(10.8) // 3.8 + 7
    expect(t.timbreFiscal).toBe(0)
    expect(t.totalTTC).toBe(130.8)
  })
  it('remise 10 % appliquée sur le HT, puis TVA sur le HT remisé', () => {
    const t = computePosTotals(items, { discountPercent: 10 })
    expect(t.grossHT).toBe(120)
    expect(t.discountAmount).toBe(12)
    expect(t.subtotalHT).toBe(108)
    expect(t.totalVAT).toBe(9.72) // 18*19% = 3.42 + 90*7% = 6.3
    expect(t.totalTTC).toBe(117.72)
    expect(t.vatByRate).toEqual([{ rate: 19, base: 18, vat: 3.42 }, { rate: 7, base: 90, vat: 6.3 }])
  })
  it('remise ligne + remise globale cumulées', () => {
    const t = computePosTotals([{ quantity: 1, unitPriceHT: 100, vatRate: 19, discount: 10 }], { discountPercent: 10 })
    expect(t.subtotalHT).toBe(81)
    expect(t.totalVAT).toBe(15.39)
  })
  it('timbre seulement si configuré ET panier non vide', () => {
    expect(computePosTotals([], { applyStamp: true }).totalTTC).toBe(0)
    expect(computePosTotals([], { applyStamp: true }).timbreFiscal).toBe(0)
    const t = computePosTotals(items, { applyStamp: true, stampAmount: 1 })
    expect(t.timbreFiscal).toBe(1)
    expect(t.totalTTC).toBe(131.8)
  })
  it('remise bornée à 0-100 %, arrondi au millime', () => {
    expect(computePosTotals(items, { discountPercent: 150 }).totalTTC).toBe(0)
    const t = computePosTotals([{ quantity: 3, unitPriceHT: 0.333, vatRate: 19 }])
    expect(t.subtotalHT).toBe(0.999)
    expect(t.totalVAT).toBe(0.19)
  })
})

describe('settlePayments', () => {
  it('espèces : monnaie rendue', () => {
    expect(settlePayments(35.7, [{ method: 'CASH', amount: 50 }])).toEqual({ paidAmount: 50, cashReceived: 50, changeGiven: 14.3, isPaid: true })
  })
  it('carte : pas de monnaie, paiement exact', () => {
    expect(settlePayments(35.7, [{ method: 'CARD', amount: 35.7 }])).toMatchObject({ changeGiven: 0, isPaid: true, cashReceived: 0 })
  })
  it('paiement insuffisant', () => {
    expect(settlePayments(35.7, [{ method: 'CASH', amount: 30 }]).isPaid).toBe(false)
  })
  it('mixte : la monnaie ne dépasse pas les espèces', () => {
    expect(settlePayments(100, [{ method: 'CARD', amount: 105 }, { method: 'CASH', amount: 2 }]).changeGiven).toBe(2)
  })
})

describe('buildZReport', () => {
  const orders = [
    { subtotalHT: 100, totalVAT: 19, timbreFiscal: 0, totalTTC: 119, discountAmount: 0, changeGiven: 1, items: [{ vatRate: 19, totalHT: 100, vatAmount: 19 }], payments: [{ method: 'CASH', amount: 120 }] },
    { subtotalHT: 50, totalVAT: 3.5, timbreFiscal: 0, totalTTC: 53.5, discountAmount: 5, changeGiven: 0, items: [{ vatRate: 7, totalHT: 50, vatAmount: 3.5 }], payments: [{ method: 'CARD', amount: 53.5 }] },
    { status: 'CANCELLED', subtotalHT: 10, totalVAT: 1.9, timbreFiscal: 0, totalTTC: 11.9, items: [], payments: [{ method: 'CASH', amount: 11.9 }] },
  ]
  it('attendu = fond + espèces nettes (les cartes ne comptent pas)', () => {
    const z = buildZReport(500, orders, 615)
    expect(z.ordersCount).toBe(2)
    expect(z.cancelledCount).toBe(1)
    expect(z.totalTTC).toBe(172.5)
    expect(z.totalHT).toBe(150)
    expect(z.totalDiscount).toBe(5)
    expect(z.cashIn).toBe(120)
    expect(z.changeGiven).toBe(1)
    expect(z.expectedCash).toBe(619)
    expect(z.cashDifference).toBe(-4)
    expect(z.byMethod).toEqual([{ method: 'CASH', amount: 120 }, { method: 'CARD', amount: 53.5 }])
    expect(z.vatByRate).toEqual([{ rate: 19, base: 100, vat: 19 }, { rate: 7, base: 50, vat: 3.5 }])
    expect(z.averageTicket).toBe(86.25)
  })
  it('session vide : attendu = fond, pas d\'écart si non compté', () => {
    const z = buildZReport(200, [])
    expect(z.expectedCash).toBe(200)
    expect(z.countedCash).toBeNull()
    expect(z.cashDifference).toBeNull()
  })
})

describe('réglages et payload', () => {
  it('timbre désactivé par défaut', () => {
    expect(readPosSettings({})).toEqual({ applyStamp: false, stampAmount: 1 })
    expect(readPosSettings(null).applyStamp).toBe(false)
    expect(readPosSettings({ pos: { applyStamp: true, stampAmount: '1.5' } })).toEqual({ applyStamp: true, stampAmount: 1.5 })
  })
  it('numéro de ticket', () => {
    expect(makeOrderNumber(new Date(2026, 9, 21, 9, 5, 3), () => 0)).toBe('T-20261021-090503-000')
  })
  it('payload de la caisse conforme au zod (orderNumber, payments[])', () => {
    const ok = posOrderSchema.safeParse({
      tenantId: 't', sessionId: 's', orderNumber: makeOrderNumber(),
      items: [{ productId: 'p', productCode: 'A', description: 'Article', quantity: 1, unitPriceHT: 25, vatRate: 19, discount: 0 }],
      payments: [{ method: 'CASH', amount: 30 }], discountPercent: 0, notes: '',
    })
    expect(ok.success).toBe(true)
    // Ancien payload (paidAmount/paymentMethod, sans payments) : rejeté
    const legacy = posOrderSchema.safeParse({ tenantId: 't', sessionId: 's', items: [{ description: 'x', quantity: 1, unitPriceHT: 1 }], paidAmount: 2, paymentMethod: 'CASH' })
    expect(legacy.success).toBe(false)
    expect(posOrderSchema.safeParse({ tenantId: 't', sessionId: 's', items: [], payments: [{ method: 'CASH', amount: 1 }] }).success).toBe(false)
  })
})
