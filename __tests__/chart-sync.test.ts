/** Complétion idempotente du plan comptable tunisien pour les tenants existants (431, 4368, 4371…). */
import { TUNISIAN_CHART_OF_ACCOUNTS } from '@/lib/tunisian-chart-of-accounts'

let rows: { tenantId: string; accountNumber: string }[] = []
const createMany = jest.fn()
jest.mock('@/lib/db', () => ({
  prisma: {
    accountingAccount: {
      findMany: ({ where }: { where: { tenantId: string } }) => Promise.resolve(rows.filter(r => r.tenantId === where.tenantId)),
      createMany: (a: { data: { tenantId: string; accountNumber: string }[]; skipDuplicates?: boolean }) => {
        createMany(a)
        const fresh = a.data.filter(d => !rows.some(r => r.tenantId === d.tenantId && r.accountNumber === d.accountNumber))
        rows.push(...fresh)
        return Promise.resolve({ count: fresh.length })
      },
    },
  },
}))

import { syncTunisianChartOfAccounts } from '@/services/accounting'

beforeEach(() => { rows = []; createMany.mockReset() })

test('tenant existant sans 431/4368/4371 : ajoutés, skipDuplicates, puis idempotent', async () => {
  rows = ['101', '411', '4366', '532', '707'].map(n => ({ tenantId: 't1', accountNumber: n }))
  rows.push({ tenantId: 't2', accountNumber: '431' })
  const r1 = await syncTunisianChartOfAccounts('t1')
  expect(r1.missing).toEqual(expect.arrayContaining(['431', '4368', '4371']))
  expect(r1.missing).not.toContain('411')
  expect(createMany.mock.calls[0][0].skipDuplicates).toBe(true)
  expect(createMany.mock.calls[0][0].data.every((d: { tenantId: string }) => d.tenantId === 't1')).toBe(true)
  expect(rows.filter(r => r.tenantId === 't1')).toHaveLength(new Set(TUNISIAN_CHART_OF_ACCOUNTS.map(a => a.accountNumber)).size)

  const r2 = await syncTunisianChartOfAccounts('t1')
  expect(r2).toEqual({ created: 0, missing: [] })
  expect(createMany).toHaveBeenCalledTimes(1)
})

test('plan vide : rien (l’initialisation reste à l’onboarding) sauf demande explicite', async () => {
  expect(await syncTunisianChartOfAccounts('t3')).toEqual({ created: 0, missing: [] })
  expect(createMany).not.toHaveBeenCalled()
  const r = await syncTunisianChartOfAccounts('t3', { evenIfEmpty: true })
  expect(r.created).toBeGreaterThan(0)
})
