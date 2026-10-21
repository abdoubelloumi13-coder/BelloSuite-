/**
 * Grand livre : regroupement pur (testable) des lignes d'écriture par compte.
 * Forme stable renvoyée par GET /api/accounting/ledger, même sans aucune écriture :
 *   { accounts: [], totalDebit: 0, totalCredit: 0, isBalanced: true, startDate, endDate }
 */
export interface LedgerInputLine {
  id: string
  debit: unknown
  credit: unknown
  description?: string | null
  account: { id: string; accountNumber: string; name: string; type: string }
  journalEntry: { date: Date | string; entryNumber: string; description: string; journal?: { code: string } | null }
}

export interface LedgerMovement {
  id: string
  date: string
  entryNumber: string
  description: string
  journal: string
  debit: number
  credit: number
}

export interface LedgerAccount {
  account: { id: string; accountNumber: string; name: string; type: string }
  movements: LedgerMovement[]
  closingDebit: number
  closingCredit: number
  balance: number
  balanceType: 'DEBIT' | 'CREDIT'
}

export interface LedgerResult {
  accounts: LedgerAccount[]
  totalDebit: number
  totalCredit: number
  isBalanced: boolean
  startDate: string | null
  endDate: string | null
}

const r3 = (n: number) => Math.round(n * 1000) / 1000

export function buildLedger(lines: LedgerInputLine[], range: { startDate?: string | null; endDate?: string | null } = {}): LedgerResult {
  const byAccount = new Map<string, LedgerAccount>()
  for (const line of lines) {
    const key = line.account.accountNumber
    let acc = byAccount.get(key)
    if (!acc) {
      const { id, accountNumber, name, type } = line.account
      acc = { account: { id, accountNumber, name, type }, movements: [], closingDebit: 0, closingCredit: 0, balance: 0, balanceType: 'DEBIT' }
      byAccount.set(key, acc)
    }
    const debit = Number(line.debit) || 0
    const credit = Number(line.credit) || 0
    acc.movements.push({
      id: line.id,
      date: new Date(line.journalEntry.date).toISOString(),
      entryNumber: line.journalEntry.entryNumber,
      description: line.description || line.journalEntry.description,
      journal: line.journalEntry.journal?.code ?? '',
      debit,
      credit,
    })
    acc.closingDebit = r3(acc.closingDebit + debit)
    acc.closingCredit = r3(acc.closingCredit + credit)
    acc.balance = r3(acc.closingDebit - acc.closingCredit)
    acc.balanceType = acc.balance >= 0 ? 'DEBIT' : 'CREDIT'
  }
  const accounts = [...byAccount.values()].sort((a, b) => a.account.accountNumber.localeCompare(b.account.accountNumber))
  const totalDebit = r3(accounts.reduce((s, a) => s + a.closingDebit, 0))
  const totalCredit = r3(accounts.reduce((s, a) => s + a.closingCredit, 0))
  return {
    accounts,
    totalDebit,
    totalCredit,
    isBalanced: Math.abs(totalDebit - totalCredit) < 0.001,
    startDate: range.startDate ?? null,
    endDate: range.endDate ?? null,
  }
}

/** Date AAAA-MM-JJ valide ou undefined (évite new Date('abc') → Invalid Date → erreur Prisma). */
export function parseDateParam(v: string | null | undefined): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}
