import { buildLedger, parseDateParam } from '@/lib/ledger'

const acc = (n: string) => ({ id: 'a' + n, accountNumber: n, name: 'C' + n, type: 'ASSET' })
const je = { date: '2026-03-01', entryNumber: 'OD-1', description: 'Écriture', journal: { code: 'OD' } }

describe('buildLedger', () => {
  it('forme stable sans écriture', () => {
    expect(buildLedger([])).toEqual({ accounts: [], totalDebit: 0, totalCredit: 0, isBalanced: true, startDate: null, endDate: null })
  })

  it('regroupe par compte, trie et calcule les soldes', () => {
    const r = buildLedger([
      { id: '1', debit: '119.000', credit: 0, account: acc('411'), journalEntry: je },
      { id: '2', debit: 0, credit: 100, account: acc('701'), journalEntry: je },
      { id: '3', debit: 0, credit: 19, account: acc('4367'), journalEntry: je },
    ])
    expect(r.accounts.map(a => a.account.accountNumber)).toEqual(['411', '4367', '701'])
    expect(r.accounts[0]).toMatchObject({ closingDebit: 119, balance: 119, balanceType: 'DEBIT' })
    expect(r.accounts[2]).toMatchObject({ closingCredit: 100, balance: -100, balanceType: 'CREDIT' })
    expect(r.accounts[0].movements[0]).toMatchObject({ journal: 'OD', entryNumber: 'OD-1', description: 'Écriture' })
    expect(r).toMatchObject({ totalDebit: 119, totalCredit: 119, isBalanced: true })
  })

  it('parseDateParam ignore les dates invalides', () => {
    expect(parseDateParam('abc')).toBeUndefined()
    expect(parseDateParam(null)).toBeUndefined()
    expect(parseDateParam('2026-01-31')?.toISOString()).toBe('2026-01-31T00:00:00.000Z')
  })
})
