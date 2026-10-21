/**
 * Statistiques du tableau de bord super admin — module SERVEUR (pas de 'use server' : ce n'est PAS une Server Action
 * appelable depuis le navigateur). Importé uniquement par le composant serveur super-admin/page.tsx.
 * Les mutations passent par les routes /api/super-admin/* protégées par requireSuperAdmin.
 */
import { prisma } from '@/lib/db'
import { getLiveSession } from '@/lib/api-auth'

export async function getSuperAdminStats() {
  // Défense en profondeur : le layout vérifie déjà le rôle, mais ce module ne doit jamais servir un non-super-admin.
  const session = await getLiveSession()
  if (session?.role !== 'SUPER_ADMIN') throw new Error('Forbidden')

  // Individually guard each query because schema migration may be incomplete in some environments
  const safeQuery = async <T>(promise: Promise<T>, name: string, fallback: T): Promise<T> => {
    try {
      return await promise
    } catch (e: any) {
      console.error(`[SuperAdminStats] Query error for table ${name}:`, e.message)
      return fallback
    }
  }

  const [
    tenants,
    users,
    modules,
    tenantModules,
    products,
    invoices,
    employees
  ] = await Promise.all([
    safeQuery(prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } }), 'Tenant', []),
    safeQuery(prisma.user.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, email: true, firstName: true, lastName: true, role: true, tenantId: true, isActive: true, createdAt: true, updatedAt: true } }), 'User', []),
    safeQuery(prisma.module.findMany(), 'Module', []),
    safeQuery(prisma.tenantModule.findMany({ include: { module: true } }), 'TenantModule', []),
    safeQuery(prisma.product.findMany(), 'Product', []),
    safeQuery(prisma.invoice.findMany(), 'Invoice', []),
    safeQuery(prisma.employee.findMany(), 'Employee', [])
  ])

  const activeModuleIds = new Set(tenantModules.filter(tm => tm.isEnabled).map(tm => tm.moduleId))
  
  // Calculer MRR basé sur les modules actifs par tenant
  let mrr = 0
  const tenantMap = new Map<string, { modules: number, price: number }>()
  for (const tm of tenantModules) {
    if (tm.isEnabled && tm.module) {
      const existing = tenantMap.get(tm.tenantId)
      if (existing) {
        existing.modules++
        existing.price += Number(tm.module.monthlyPrice) || 0
      } else {
        tenantMap.set(tm.tenantId, { modules: 1, price: Number(tm.module.monthlyPrice) || 0 })
      }
    }
  }
  mrr = Array.from(tenantMap.values()).reduce((sum, t) => sum + t.price, 0)

  // Users par tenant
  const usersByTenant = new Map<string, number>()
  for (const u of users) {
    if (u.tenantId) {
      usersByTenant.set(u.tenantId, (usersByTenant.get(u.tenantId) || 0) + 1)
    }
  }

  // Modules par tenant
  const modulesByTenant = new Map<string, number>()
  for (const tm of tenantModules) {
    if (tm.isEnabled) {
      modulesByTenant.set(tm.tenantId, (modulesByTenant.get(tm.tenantId) || 0) + 1)
    }
  }

  const tenantsWithStats = tenants.map(t => ({
    ...t,
    userCount: usersByTenant.get(t.id) || 0,
    moduleCount: modulesByTenant.get(t.id) || 0,
    activeModuleIds: tenantModules.filter(tm => tm.tenantId === t.id && tm.isEnabled).map(tm => tm.moduleId)
  }))

  return {
    stats: {
      totalTenants: tenants.length,
      totalUsers: users.length,
      activeModules: activeModuleIds.size,
      totalModules: modules.length,
      totalProducts: products.length,
      totalInvoices: invoices.length,
      totalEmployees: employees.length,
      mrr
    },
    tenants: tenantsWithStats,
    modules,
    recentUsers: users.slice(0, 10)
  }
}
