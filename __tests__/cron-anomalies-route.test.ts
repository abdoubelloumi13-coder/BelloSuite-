/** Route /api/cron/anomalies : authentification CRON_SECRET, délégation au lot, migration absente → 503. */
import { Prisma } from '@prisma/client'

const runAnomalyCronBatch = jest.fn()
jest.mock('@/lib/db', () => ({ prisma: {} }))
jest.mock('@/services/anomalies', () => ({
  ...jest.requireActual('@/services/anomalies'),
  runAnomalyCronBatch: (...a: unknown[]) => runAnomalyCronBatch(...a),
}))

import { GET, POST } from '@/app/api/cron/anomalies/route'
import { tunisDay, emailOptOut, isMissingTableError } from '@/services/anomalies'

const SECRET = 'c'.repeat(32)
const OLD = process.env.CRON_SECRET
const req = (url = 'http://localhost/api/cron/anomalies', headers: Record<string, string> = {}) => new Request(url, { headers })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = SECRET
  runAnomalyCronBatch.mockResolvedValue({ day: '2026-10-11', processed: 1, remaining: 0, done: true, results: [] })
})
afterAll(() => { if (OLD === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = OLD })

describe('/api/cron/anomalies', () => {
  it('refuse sans secret / mauvais secret, 500 si CRON_SECRET absent', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req(undefined, { authorization: 'Bearer nope' }))).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await GET(req(undefined, { authorization: `Bearer ${SECRET}` }))).status).toBe(500)
    expect(runAnomalyCronBatch).not.toHaveBeenCalled()
  })
  it('Bearer (Vercel Cron) ou x-cron-secret (pg_cron) → lance le lot avec email et budget', async () => {
    const r = await GET(req(undefined, { authorization: `Bearer ${SECRET}` }))
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ success: true, processed: 1, done: true })
    expect(runAnomalyCronBatch).toHaveBeenCalledWith({ tenantId: null, sendEmail: true, budgetMs: 40_000 })
    await POST(req('http://localhost/api/cron/anomalies?tenantId=t1&email=0', { 'x-cron-secret': SECRET }))
    expect(runAnomalyCronBatch).toHaveBeenLastCalledWith({ tenantId: 't1', sendEmail: false, budgetMs: 40_000 })
  })
  it('tables absentes → 503 explicite ; autre erreur → 500', async () => {
    runAnomalyCronBatch.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2021', clientVersion: 'x' }))
    const r = await GET(req(undefined, { authorization: `Bearer ${SECRET}` }))
    expect(r.status).toBe(503)
    expect((await r.json()).code).toBe('ANOMALY_TABLES_MISSING')
    runAnomalyCronBatch.mockRejectedValueOnce(new Error('boom'))
    jest.spyOn(console, 'error').mockImplementationOnce(() => undefined)
    expect((await GET(req(undefined, { authorization: `Bearer ${SECRET}` }))).status).toBe(500)
  })
})

describe('helpers du service', () => {
  it('tunisDay : jour calendaire à Tunis (UTC+1)', () => {
    expect(tunisDay(new Date('2026-10-11T23:30:00Z'))).toBe('2026-10-12')
    expect(tunisDay(new Date('2026-10-11T05:00:00Z'))).toBe('2026-10-11')
  })
  it('emailOptOut lit Tenant.settings.anomalies.emailOptOut', () => {
    expect(emailOptOut({ anomalies: { emailOptOut: ['u1', 3] } })).toEqual(['u1'])
    expect(emailOptOut({})).toEqual([])
  })
  it('isMissingTableError', () => {
    expect(isMissingTableError(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2021', clientVersion: 'x' }))).toBe(true)
    expect(isMissingTableError(new Error('x'))).toBe(false)
  })
})
