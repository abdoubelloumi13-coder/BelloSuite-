import { computeSettlement, isPostableSaleType, SettlementError, buildAutoEntryLines } from '@/lib/accounting-auto'

describe('comptabilisation : types concernés', () => {
  it('factures et avoirs uniquement', () => {
    expect(isPostableSaleType('INVOICE')).toBe(true)
    expect(isPostableSaleType('CREDIT_NOTE')).toBe(true)
    expect(isPostableSaleType('INVOICE_HONORARY')).toBe(true)
    expect(isPostableSaleType('QUOTE')).toBe(false)
    expect(isPostableSaleType('ORDER')).toBe(false)
    expect(isPostableSaleType('DELIVERY_NOTE')).toBe(false)
  })
  it('BL : aucune ligne générée', () => {
    expect(buildAutoEntryLines({ type: 'DELIVERY_NOTE', totalTTC: 120, subtotalHT: 100 }).lines).toEqual([])
  })
})

describe('règlement d\'une facture de vente', () => {
  it('règlement total par défaut, équilibré', () => {
    const s = computeSettlement({ totalTTC: 1191, alreadySettled: 0 })
    expect(s.amount).toBe(1191)
    expect(s.fullyPaid).toBe(true)
    expect(s.lines).toEqual([
      { account: '532', label: 'Encaissement banque', debit: 1191, credit: 0 },
      { account: '411', label: 'Clients', debit: 0, credit: 1191 },
    ])
  })
  it('RS subie 3 % : 4341 au débit, encaissement net', () => {
    const s = computeSettlement({ totalTTC: 1500, alreadySettled: 0, rsAmount: 45, method: 'CASH' })
    expect(s.amount).toBe(1455)
    expect(s.lines.map(l => [l.account, l.debit, l.credit])).toEqual([['541', 1455, 0], ['4341', 45, 0], ['411', 0, 1500]])
    expect(s.fullyPaid).toBe(true)
  })
  it('paiements partiels successifs puis refus au-delà du reste dû', () => {
    const p1 = computeSettlement({ totalTTC: 1000, alreadySettled: 0, amount: 400 })
    expect(p1.fullyPaid).toBe(false)
    expect(p1.remainingAfter).toBe(600)
    const p2 = computeSettlement({ totalTTC: 1000, alreadySettled: 400 })
    expect(p2.amount).toBe(600)
    expect(p2.fullyPaid).toBe(true)
    expect(() => computeSettlement({ totalTTC: 1000, alreadySettled: 400, amount: 700 })).toThrow(/reste dû/)
    expect(() => computeSettlement({ totalTTC: 1000, alreadySettled: 1000 })).toThrow(SettlementError)
  })
  it('avoir lié déduit du reste dû', () => {
    const s = computeSettlement({ totalTTC: 1191, alreadySettled: 0, credited: 595 })
    expect(s.amount).toBe(596)
  })
})
