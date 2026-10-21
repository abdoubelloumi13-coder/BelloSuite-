/**
 * @jest-environment node
 */
/* Révocation des sessions (session-guard) et contrôle de rôle intra-entreprise (rbac).
 */
jest.mock('@/lib/db', () => ({ prisma: {} }))
import { evaluateSession, firmEffectiveRole, DEMO_EMAIL, type LiveIdentity } from '@/lib/session-guard'
import { canAccess, requireAccess, requireTenantRole } from '@/lib/rbac'
import type { SessionPayload } from '@/lib/session'

const s: SessionPayload = { id: 'u1', email: 'a@b.tn', role: 'ADMIN', tenantId: 'T1', firstName: 'A' }
const live: LiveIdentity = { email: 'a@b.tn', role: 'ADMIN', tenantId: 'T1', isActive: true }

describe('evaluateSession', () => {
  it('accepte une session cohérente avec la base', () => {
    expect(evaluateSession(s, live, true)).toEqual({ session: s })
  })
  it('refuse un utilisateur supprimé ou désactivé (401)', () => {
    expect(evaluateSession(s, null, true)).toMatchObject({ status: 401 })
    expect(evaluateSession(s, { ...live, isActive: false }, true)).toMatchObject({ status: 401, error: 'Compte désactivé' })
  })
  it('applique immédiatement une rétrogradation (rôle lu en base)', () => {
    const v = evaluateSession(s, { ...live, role: 'USER' }, true)
    expect(v).toMatchObject({ session: { role: 'USER' } })
  })
  it('retire le SUPER_ADMIN figé dans un ancien jeton', () => {
    const v = evaluateSession({ ...s, role: 'SUPER_ADMIN' }, { ...live, role: 'USER' }, true)
    expect(v).toMatchObject({ session: { role: 'USER' } })
  })
  it('exige une reconnexion si l’entreprise a changé', () => {
    expect(evaluateSession(s, { ...live, tenantId: 'T2' }, true)).toMatchObject({ status: 401 })
  })
  it('bloque une entreprise suspendue (403) sauf pour le SUPER_ADMIN', () => {
    expect(evaluateSession(s, live, false)).toMatchObject({ status: 403 })
    expect(evaluateSession(s, live, null)).toMatchObject({ status: 403 })
    const sa = { ...s, role: 'SUPER_ADMIN' }
    expect(evaluateSession(sa, { ...live, role: 'SUPER_ADMIN' }, false)).toMatchObject({ session: { role: 'SUPER_ADMIN' } })
  })
  it('plafonne la démo à USER avec le drapeau demo, même si le compte est ADMIN en base', () => {
    const d = { ...s, email: DEMO_EMAIL }
    const v = evaluateSession(d, { ...live, email: DEMO_EMAIL }, true)
    expect(v).toMatchObject({ session: { role: 'USER', demo: true } })
  })
  it('ne laisse pas un jeton non-démo porter le drapeau demo', () => {
    const v = evaluateSession({ ...s, demo: true }, live, true)
    expect('session' in v && v.session.demo).toBeFalsy()
  })
  it('session cabinet : rôle dérivé du rôle dans le cabinet, tenant client vérifié', () => {
    const firm = { ...s, tenantId: 'CLIENT', firmId: 'F1', homeTenantId: 'T1', firmRole: 'STAFF' }
    expect(evaluateSession(firm, live, true)).toMatchObject({ session: { role: 'USER', tenantId: 'CLIENT' } })
    expect(evaluateSession({ ...firm, firmRole: 'OWNER' }, live, true)).toMatchObject({ session: { role: 'ADMIN' } })
    expect(evaluateSession(firm, live, false)).toMatchObject({ status: 403 })
  })
})

describe('firmEffectiveRole', () => {
  it('OWNER → ADMIN, tout le reste → USER', () => {
    expect(firmEffectiveRole('OWNER')).toBe('ADMIN')
    expect(firmEffectiveRole('STAFF')).toBe('USER')
    expect(firmEffectiveRole(undefined)).toBe('USER')
  })
})

describe('rbac', () => {
  const ctx = (userRole: string, user: Record<string, unknown> = {}) => ({ userRole, user: { role: userRole, ...user } })
  it('ADMIN et SUPER_ADMIN : tout', () => {
    expect(canAccess(ctx('ADMIN'), 'settings:write')).toBe(true)
    expect(canAccess(ctx('SUPER_ADMIN'), 'users:manage')).toBe(true)
  })
  it('USER (caissier, magasinier) : ni paie, ni écritures, ni paramètres', () => {
    for (const a of ['hr:read', 'hr:write', 'accounting:write', 'settings:write', 'users:manage'] as const) {
      expect(canAccess(ctx('USER'), a)).toBe(false)
    }
    expect(requireAccess(ctx('USER'), 'hr:read')?.status).toBe(403)
  })
  it('collaborateur cabinet STAFF : paie et compta, pas les paramètres TTN', () => {
    const staff = ctx('USER', { firmId: 'F1', firmRole: 'STAFF' })
    expect(canAccess(staff, 'hr:write')).toBe(true)
    expect(canAccess(staff, 'accounting:write')).toBe(true)
    expect(canAccess(staff, 'settings:write')).toBe(false)
    expect(canAccess(staff, 'users:manage')).toBe(false)
  })
  it('démo : lecture paie seulement, aucun envoi', () => {
    const demo = ctx('USER', { demo: true })
    expect(canAccess(demo, 'hr:read')).toBe(true)
    expect(canAccess(demo, 'hr:write')).toBe(false)
    expect(canAccess(demo, 'outbound:send')).toBe(false)
  })
  it('requireTenantRole', () => {
    expect(requireTenantRole(ctx('ADMIN'), ['ADMIN'])).toBeNull()
    expect(requireTenantRole(ctx('USER'), ['ADMIN'])?.status).toBe(403)
    expect(requireTenantRole(ctx('SUPER_ADMIN'), ['ADMIN'])).toBeNull()
  })
})
