import { validateEntryLines, entryTotals, nextEntryNumber } from '@/lib/journal-entry-logic'

describe('écriture manuelle', () => {
  it('accepte une écriture équilibrée', () => {
    expect(validateEntryLines([
      { accountId: 'a', debit: 119, credit: 0 },
      { accountId: 'b', debit: 0, credit: 100 },
      { accountId: 'c', debit: 0, credit: 19 },
    ])).toBeNull()
  })
  it('refuse le déséquilibre, une ligne unique, débit+crédit sur une ligne', () => {
    expect(validateEntryLines([{ accountId: 'a', debit: 10, credit: 0 }, { accountId: 'b', debit: 0, credit: 9 }])).toMatch(/déséquilibrée/)
    expect(validateEntryLines([{ accountId: 'a', debit: 10, credit: 0 }])).toMatch(/deux lignes/)
    expect(validateEntryLines([{ accountId: 'a', debit: 10, credit: 10 }, { accountId: 'b', debit: 0, credit: 0 }, { accountId: 'c', debit: 0, credit: 0 }])).toMatch(/deux lignes/)
    expect(validateEntryLines([{ accountId: 'a', debit: 5, credit: 5 }, { accountId: 'b', debit: 5, credit: 5 }])).toMatch(/à la fois/)
    expect(validateEntryLines([{ accountId: '', debit: 5, credit: 0 }, { accountId: 'b', debit: 0, credit: 5 }])).toMatch(/compte/)
  })
  it('totaux arrondis au millime', () => {
    expect(entryTotals([{ debit: 0.1, credit: 0 }, { debit: 0.2, credit: 0 }])).toEqual({ debit: 0.3, credit: 0 })
  })
  it('numérotation séquentielle par journal et année', () => {
    expect(nextEntryNumber('OD', 2026, [])).toBe('OD-2026-0001')
    expect(nextEntryNumber('OD', 2026, ['OD-2026-0009', 'OD-2026-0010', 'VT-2026-0099'])).toBe('OD-2026-0011')
  })
})
