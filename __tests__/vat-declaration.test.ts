import { computeVatDeclaration, monthRange } from '@/lib/vat-declaration'

const sale = (items: Array<[number, number, number, number?]>, extra: Partial<{ type: string; timbreFiscal: number; totalFodec: number }> = {}) => ({
  type: 'INVOICE', timbreFiscal: 1, totalFodec: 0, totalVAT: items.reduce((s, i) => s + i[2], 0), subtotalHT: items.reduce((s, i) => s + i[1], 0),
  items: items.map(([vatRate, totalHT, vatAmount, fodecAmount = 0]) => ({ vatRate, totalHT, vatAmount, fodecAmount })),
  ...extra,
})

describe('computeVatDeclaration', () => {
  it('TVA collectée par taux (assiette HT + FODEC), timbre, FODEC, TVA due', () => {
    const d = computeVatDeclaration({
      month: 10, year: 2026,
      sales: [
        sale([[19, 1000, 191.9, 10], [7, 200, 14]], { totalFodec: 10 }),
        sale([[19, 500, 95]]),
      ],
      purchases: [{ subtotal: 400, taxAmount: 76, total: 476 }],
    })
    expect(d.collected.byRate).toEqual([
      { rate: 19, base: 1510, vat: 286.9 },
      { rate: 7, base: 200, vat: 14 },
    ])
    expect(d.collected.total).toBe(300.9)
    expect(d.deductible.total).toBe(76)
    expect(d.vatDue).toBe(224.9)
    expect(d.fodec).toBe(10)
    expect(d.stamp).toBe(2)
    expect(d.totalToPay).toBe(236.9)
    expect(d.status).toBe('TO_PAY')
  })

  it('avoir déduit, crédit reporté → crédit de TVA', () => {
    const d = computeVatDeclaration({
      month: 1, year: 2026,
      sales: [sale([[19, 100, 19]]), sale([[19, 100, 19]], { type: 'CREDIT_NOTE', timbreFiscal: 1 })],
      purchases: [{ subtotal: 100, taxAmount: 19, total: 119 }],
      previousCredit: 5,
    })
    expect(d.collected.byRate).toEqual([])
    expect(d.collected.total).toBe(0)
    expect(d.vatCredit).toBe(24)
    expect(d.vatDue).toBe(0)
    expect(d.stamp).toBe(1)
    expect(d.status).toBe('CREDIT')
    expect(d.creditNotes).toBe(1)
  })

  it('document sans TVA par ligne : rattaché au taux normal', () => {
    const d = computeVatDeclaration({ month: 2, year: 2026, sales: [{ type: 'INVOICE', totalFodec: 0, totalVAT: 19, timbreFiscal: 1, subtotalHT: 100, items: [] }], purchases: [] })
    expect(d.collected.byRate).toEqual([{ rate: 19, base: 100, vat: 19 }])
  })

  it('aucun document → NIL', () => {
    expect(computeVatDeclaration({ month: 3, year: 2026, sales: [], purchases: [] })).toMatchObject({ status: 'NIL', totalToPay: 0 })
  })

  it('monthRange couvre tout le mois', () => {
    const { start, end } = monthRange(2, 2028)
    expect(start.getDate()).toBe(1)
    expect(end.getDate()).toBe(29)
  })
})
