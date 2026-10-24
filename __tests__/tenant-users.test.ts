import { checkTenantUserChange, tenantCreateUserSchema, tenantUpdateUserSchema, userStats } from '@/services/tenant-users'

const T = 'tenant-1'
const admin = { id: 'a', email: 'boss@x.tn', role: 'ADMIN', isActive: true, tenantId: T }
const user = { id: 'u', email: 'caisse@x.tn', role: 'USER', isActive: true, tenantId: T }

describe('checkTenantUserChange', () => {
  it('refuse un utilisateur d\'une autre entreprise', () => {
    expect(checkTenantUserChange({ actorEmail: 'boss@x.tn', tenantId: T, target: { ...user, tenantId: 'other' }, change: { isActive: false }, activeAdmins: 2 })).toMatch(/introuvable/)
  })
  it('refuse de toucher un super admin', () => {
    expect(checkTenantUserChange({ actorEmail: 'boss@x.tn', tenantId: T, target: { ...user, role: 'SUPER_ADMIN' }, change: { firstName: 'x' }, activeAdmins: 2 })).not.toBeNull()
  })
  it('refuse de se désactiver ou de se rétrograder soi-même', () => {
    expect(checkTenantUserChange({ actorEmail: 'BOSS@x.tn', tenantId: T, target: admin, change: { isActive: false }, activeAdmins: 3 })).toMatch(/propre compte/)
    expect(checkTenantUserChange({ actorEmail: 'boss@x.tn', tenantId: T, target: admin, change: { role: 'USER' }, activeAdmins: 3 })).toMatch(/propres droits/)
  })
  it('garde au moins un admin actif', () => {
    const other = { ...admin, id: 'b', email: 'b@x.tn' }
    expect(checkTenantUserChange({ actorEmail: 'boss@x.tn', tenantId: T, target: other, change: { role: 'USER' }, activeAdmins: 1 })).toMatch(/au moins un/)
    expect(checkTenantUserChange({ actorEmail: 'boss@x.tn', tenantId: T, target: other, change: { role: 'USER' }, activeAdmins: 2 })).toBeNull()
  })
  it('autorise la gestion courante', () => {
    expect(checkTenantUserChange({ actorEmail: 'boss@x.tn', tenantId: T, target: user, change: { isActive: false }, activeAdmins: 1 })).toBeNull()
    expect(checkTenantUserChange({ actorEmail: 'boss@x.tn', tenantId: T, target: user, change: { role: 'ADMIN' }, activeAdmins: 1 })).toBeNull()
    expect(checkTenantUserChange({ actorEmail: 'boss@x.tn', tenantId: T, target: admin, change: { firstName: 'Ali' }, activeAdmins: 1 })).toBeNull()
  })
})

describe('schémas', () => {
  it('interdit la création d\'un SUPER_ADMIN et un tenantId fourni par le client', () => {
    expect(tenantCreateUserSchema.safeParse({ email: 'a@b.tn', password: '0123456789', role: 'SUPER_ADMIN' }).success).toBe(false)
    expect(tenantCreateUserSchema.safeParse({ email: 'a@b.tn', password: '0123456789', tenantId: 'x' }).success).toBe(false)
    expect(tenantCreateUserSchema.safeParse({ email: ' A@B.tn ', password: '0123456789' }).data?.email).toBe('a@b.tn')
  })
  it('refuse un PATCH vide ou un rôle inconnu', () => {
    expect(tenantUpdateUserSchema.safeParse({}).success).toBe(false)
    expect(tenantUpdateUserSchema.safeParse({ role: 'SUPER_ADMIN' }).success).toBe(false)
  })
})

it('userStats', () => {
  expect(userStats([admin, user, { ...user, isActive: false }, { ...admin, isActive: false }])).toEqual({ total: 4, active: 2, inactive: 2, admins: 1 })
})
