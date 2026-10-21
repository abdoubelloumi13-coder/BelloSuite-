import { getSuperAdminStats } from '@/lib/super-admin/stats'
import { redirect } from 'next/navigation'
import SuperAdminDashboardClient from './SuperAdminDashboardClient'

export const dynamic = 'force-dynamic'

export default async function SuperAdminDashboard() {
  let data
  try {
    data = await getSuperAdminStats()
  } catch (e) {
    console.error('CRITICAL: Error fetching super admin stats:', e)
    // Fallback to empty state instead of redirecting
    data = {
      stats: { totalTenants: 0, totalUsers: 0, activeModules: 0, mrr: 0, totalProducts: 0, totalInvoices: 0, totalEmployees: 0, totalModules: 0 },
      tenants: [],
      modules: [],
      recentUsers: []
    }
  }

  const { stats, tenants, modules, recentUsers } = data

  return (
    <SuperAdminDashboardClient 
      stats={stats} 
      initialTenants={tenants} 
      initialUsers={recentUsers} 
      modules={modules} 
    />
  )
}
