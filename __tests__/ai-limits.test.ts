/**
 * @jest-environment node
 */
/* Audit E6/E7 : bornes IA (entreprise, utilisateur, démo publique). */
jest.mock('@/lib/db', () => ({ prisma: {} }))
import { aiLimits, DEMO_AI_PER_IP_HOUR, DEMO_AI_TENANT_DAY, DEMO_AI_TENANT_HOURLY_CAP } from '@/lib/security/ai-limits'

describe('aiLimits', () => {
  it('entreprise + utilisateur (moitié du quota)', () => {
    expect(aiLimits({ tenantId: 'T', user: { id: 'U' } }, '1.1.1.1', 'x', 30)).toEqual([
      { key: 'x:tenant:T', max: 30, windowSeconds: 3600 },
      { key: 'x:user:U', max: 15, windowSeconds: 3600 },
    ])
  })
  it('démo : quota plafonné, borne par IP et journalière', () => {
    const l = aiLimits({ tenantId: 'D', user: { id: 'U', demo: true } }, '9.9.9.9', 'fiscal-search', 120)
    expect(l).toEqual([
      { key: 'fiscal-search:tenant:D', max: DEMO_AI_TENANT_HOURLY_CAP, windowSeconds: 3600 },
      { key: 'ai-demo:ip:9.9.9.9', max: DEMO_AI_PER_IP_HOUR, windowSeconds: 3600 },
      { key: 'ai-demo:tenant:D:day', max: DEMO_AI_TENANT_DAY, windowSeconds: 86400 },
    ])
  })
})
