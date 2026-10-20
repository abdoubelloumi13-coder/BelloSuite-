/**
 * @jest-environment node
 *
 * Session « cabinet dans le dossier d'un client » : accès revérifié en base à chaque requête.
 */
jest.mock('@/lib/db', () => ({
  prisma: {
    firmMember: { count: jest.fn() },
    firmClientAccess: { count: jest.fn() },
  },
}))
import { prisma } from '@/lib/db'
import { firmSessionStillValid } from '@/lib/firm-access'

const p = prisma as unknown as { firmMember: { count: jest.Mock }; firmClientAccess: { count: jest.Mock } }
const s = { id: 'u1', firmId: 'f1', tenantId: 'client-1', homeTenantId: 'home-1' }

beforeEach(() => { p.firmMember.count.mockReset(); p.firmClientAccess.count.mockReset() })

describe('firmSessionStillValid', () => {
  it('session ordinaire : rien à vérifier', async () => {
    await expect(firmSessionStillValid({ id: 'u1', tenantId: 't' })).resolves.toBe(true)
    expect(p.firmClientAccess.count).not.toHaveBeenCalled()
  })
  it('membre + accès actif : valide', async () => {
    p.firmMember.count.mockResolvedValue(1); p.firmClientAccess.count.mockResolvedValue(1)
    await expect(firmSessionStillValid(s)).resolves.toBe(true)
    expect(p.firmClientAccess.count).toHaveBeenCalledWith({ where: { firmId: 'f1', tenantId: 'client-1', status: 'ACTIVE' } })
  })
  it('accès révoqué par l’entreprise : refusé immédiatement', async () => {
    p.firmMember.count.mockResolvedValue(1); p.firmClientAccess.count.mockResolvedValue(0)
    await expect(firmSessionStillValid(s)).resolves.toBe(false)
  })
  it('collaborateur retiré du cabinet : refusé', async () => {
    p.firmMember.count.mockResolvedValue(0); p.firmClientAccess.count.mockResolvedValue(1)
    await expect(firmSessionStillValid(s)).resolves.toBe(false)
  })
  it('retour au compte propre : pas de vérification cabinet', async () => {
    await expect(firmSessionStillValid({ ...s, tenantId: 'home-1' })).resolves.toBe(true)
  })
})
