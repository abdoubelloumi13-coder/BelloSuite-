'use client'

import { useState, useEffect, useCallback } from 'react'
import { Link } from '@/i18n/routing'
import {
  Users, Building2, TrendingUp, Search, Filter, MoreVertical,
  Globe, Plus, Settings2, ShieldCheck, ShieldAlert, Mail,
  Package, Zap, Activity, CheckCircle2, XCircle, RefreshCcw
} from 'lucide-react'
import ModuleManagementModal from '@/components/super-admin/ModuleManagementModal'
import CreateTenantModal from '@/components/super-admin/CreateTenantModal'
import CreateUserModal from '@/components/super-admin/CreateUserModal'
import Header from './Header'
import { useTranslations, useLocale } from 'next-intl'

function StatCard({ label, value, trend, icon: Icon, color }: any) {
  return (
    <div className={`bg-zinc-900/40 backdrop-blur-xl rounded-[2rem] p-6 border border-zinc-800/50 hover:border-${color}-500/30 transition-all group overflow-hidden relative`}>
      <div className={`absolute top-0 right-0 w-40 h-40 bg-${color}-500/5 rounded-full -mr-20 -mt-20 blur-3xl group-hover:bg-${color}-500/10 transition-all`} />
      <div className="flex justify-between items-start relative z-10">
        <div className={`p-3 rounded-2xl bg-${color}-500/10 border border-${color}-500/20`}>
          <Icon className={`w-6 h-6 text-${color}-400`} />
        </div>
        {trend && <span className="flex items-center gap-1 text-[10px] font-black text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded-full uppercase">+{trend}% <TrendingUp className="w-3 h-3" /></span>}
      </div>
      <div className="mt-6 relative z-10">
        <p className="text-3xl font-black text-white tracking-tight">{value}</p>
        <p className="text-sm font-bold text-zinc-500 mt-1 uppercase tracking-widest">{label}</p>
      </div>
    </div>
  )
}

export default function SuperAdminDashboardClient({ stats: initialStats, initialTenants, initialUsers, modules: initialModules }: any) {
  const ts = useTranslations('SuperAdmin.dashboard')
  const locale = useLocale()
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'tenants' | 'users' | 'modules'>('tenants')
  const [tenants, setTenants] = useState(initialTenants)
  const [users, setUsers] = useState(initialUsers)
  const [modules, setModules] = useState(initialModules)
  const [stats, setStats] = useState(initialStats)
  const [selectedTenant, setSelectedTenant] = useState<any>(null)
  const [isModuleModalOpen, setModuleModalOpen] = useState(false)
  const [isCreateTenantOpen, setCreateTenantOpen] = useState(false)
  const [isCreateUserOpen, setCreateUserOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [userSearch, setUserSearch] = useState('')

  const refreshData = useCallback(async () => {
    setRefreshing(true)
    try {
      const [tenantsRes, usersRes, modulesRes] = await Promise.all([
        fetch('/api/super-admin/tenants'),
        fetch('/api/super-admin/users'),
        fetch('/api/super-admin/modules')
      ])
      const [tenantsData, usersData, modulesData] = await Promise.all([tenantsRes.json(), usersRes.json(), modulesRes.json()])
      if (Array.isArray(tenantsData)) {
        setTenants(tenantsData.map((t: any) => ({
          ...t,
          userCount: t.users?.length || 0,
          activeModuleIds: t.modules?.filter((tm: any) => tm.isEnabled).map((tm: any) => tm.moduleId) || []
        })))
        setStats((s: any) => ({ ...s, totalTenants: tenantsData.length }))
      }
      if (Array.isArray(usersData)) setUsers(usersData)
      if (Array.isArray(modulesData)) setModules(modulesData)
    } catch (e) { console.error(e) } finally { setRefreshing(false) }
  }, [])

  const handleToggleUser = async (userId: string, isActive: boolean) => {
    await fetch(`/api/super-admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive })
    })
    refreshData()
  }

  const handleToggleTenant = async (tenantId: string, isActive: boolean) => {
    await fetch(`/api/super-admin/tenants/${tenantId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive })
    })
    refreshData()
  }

  const filteredTenants = tenants.filter((t: any) =>
    t.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.subdomain?.toLowerCase().includes(search.toLowerCase())
  )

  const filteredUsers = users.filter((u: any) =>
    u.email?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.firstName?.toLowerCase().includes(userSearch.toLowerCase()) ||
    u.lastName?.toLowerCase().includes(userSearch.toLowerCase())
  ).filter((u: any) => u.role !== 'SUPER_ADMIN')

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-20">
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-emerald-500/5 blur-[120px] pointer-events-none" />
      <Header title={ts('title')} subtitle={ts('subtitle')} />

      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10 relative z-10">
        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          <StatCard label={ts('active_clients')} value={stats.totalTenants} trend={12} icon={Building2} color="emerald" />
          <StatCard label={ts('mrr')} value={`${stats.mrr?.toLocaleString(`${locale}-TN`) || 0}`} trend={8} icon={TrendingUp} color="blue" />
          <StatCard label={ts('users')} value={stats.totalUsers} trend={24} icon={Users} color="purple" />
          <StatCard label={ts('active_modules')} value={stats.activeModules} icon={Zap} color="amber" />
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex gap-1 bg-zinc-900 p-1 rounded-2xl border border-zinc-800">
            {(['tenants', 'users', 'modules'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === tab ? 'bg-white text-zinc-950' : 'text-zinc-500 hover:text-white'}`}>
                {tab === 'tenants' ? ts('tab_tenants') : tab === 'users' ? ts('tab_users') : ts('tab_modules')}
              </button>
            ))}
          </div>
          <div className="flex gap-3">
            <button onClick={refreshData} className={`p-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all ${refreshing ? 'animate-spin' : ''}`}>
              <RefreshCcw className="w-4 h-4" />
            </button>
            {activeTab === 'tenants' && (
              <button onClick={() => setCreateTenantOpen(true)} className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl text-xs transition-all">
                <Plus className="w-4 h-4" /> {ts('new_client')}
              </button>
            )}
            {activeTab === 'users' && (
              <button onClick={() => setCreateUserOpen(true)} className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-400 text-white font-bold rounded-xl text-xs transition-all">
                <Plus className="w-4 h-4" /> {ts('new_user')}
              </button>
            )}
          </div>
        </div>

        {/* ============ TENANTS TAB ============ */}
        {activeTab === 'tenants' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute start-4 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input type="text" placeholder={ts('search_client')} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl ps-11 pe-4 py-3 text-sm text-white outline-none focus:border-emerald-500 transition-all" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[2rem] overflow-hidden">
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <table className="w-full">
                <thead>
                  <tr className="bg-zinc-800/30 border-b border-zinc-800/50">
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('company')}</th>
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('subdomain')}</th>
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('modules')}</th>
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('users')}</th>
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('status')}</th>
                    <th className="px-6 py-4 text-end text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('actions')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {filteredTenants.length === 0 ? (
                    <tr><td colSpan={6} className="px-6 py-16 text-center text-zinc-600 font-medium">{ts('no_clients')}</td></tr>
                  ) : filteredTenants.map((t: any) => (
                    <tr key={t.id} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-zinc-800 flex items-center justify-center font-black text-white border border-zinc-700">
                            {t.name?.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-white text-sm">{t.name}</p>
                            {t.matriculeFiscal && <p className="text-[10px] text-zinc-600 font-mono">{t.matriculeFiscal}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-zinc-500 text-xs">
                          <Globe className="w-3 h-3 text-emerald-500" />
                          {t.subdomain}.bellosuite.tn
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-zinc-300 bg-zinc-800 px-2.5 py-1 rounded-lg">{t.activeModuleIds?.length || t.modules?.filter((m:any)=>m.isEnabled)?.length || 0} modules</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-zinc-400">{t.userCount || t.users?.length || 0} users</span>
                      </td>
                      <td className="px-6 py-4">
                        <button onClick={() => handleToggleTenant(t.id, t.isActive)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-all ${t.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                          {t.isActive ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {t.isActive ? ts('active') : ts('inactive')}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-end">
                        <button onClick={() => { setSelectedTenant(t); setModuleModalOpen(true) }} className="flex items-center gap-2 ml-auto px-3 py-2 text-[10px] font-black uppercase text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 rounded-xl transition-all border border-transparent hover:border-zinc-700">
                          <Settings2 className="w-4 h-4" /> {ts('modules')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ============ USERS TAB ============ */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute start-4 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input type="text" placeholder={ts('search_user')} className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl ps-11 pe-4 py-3 text-sm text-white outline-none focus:border-blue-500 transition-all" value={userSearch} onChange={e => setUserSearch(e.target.value)} />
            </div>

            <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[2rem] overflow-hidden">
              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                <table className="w-full">
                <thead>
                  <tr className="bg-zinc-800/30 border-b border-zinc-800/50">
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('user')}</th>
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('client_tenant')}</th>
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('role')}</th>
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('created_at')}</th>
                    <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{ts('status')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {filteredUsers.length === 0 ? (
                    <tr><td colSpan={5} className="px-6 py-16 text-center text-zinc-600 font-medium">{ts('no_users')}</td></tr>
                  ) : filteredUsers.map((u: any) => (
                    <tr key={u.id} className="group hover:bg-white/[0.02] transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-zinc-800 flex items-center justify-center font-black text-white border border-zinc-700 text-sm">
                            {u.firstName?.charAt(0) || u.email?.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-white text-sm">{u.firstName || ''} {u.lastName || ''}</p>
                            <div className="flex items-center gap-1 text-[10px] text-zinc-500"><Mail className="w-3 h-3" />{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {u.tenant ? (
                          <span className="text-xs font-bold text-zinc-300 bg-zinc-800 px-2.5 py-1 rounded-lg">{u.tenant.name}</span>
                        ) : (
                          <span className="text-[10px] font-black uppercase text-zinc-600">{ts('unassigned')}</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${u.role === 'ADMIN' ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-800 text-zinc-400'}`}>
                          {u.role === 'ADMIN' ? ts('role_admin') : ts('role_user')}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs text-zinc-600">{new Date(u.createdAt).toLocaleDateString(`${locale}-TN`)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <button onClick={() => handleToggleUser(u.id, u.isActive)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase border transition-all ${u.isActive ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>
                          {u.isActive ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                          {u.isActive ? ts('active') : ts('inactive')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ============ MODULES TAB ============ */}
        {activeTab === 'modules' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {modules.map((mod: any) => (
              <div key={mod.id} className="bg-zinc-900/40 border border-zinc-800/50 rounded-[2rem] p-6 hover:border-emerald-500/20 transition-all group">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-3xl group-hover:scale-110 transition-transform">{mod.icon}</div>
                  <span className={`px-2.5 py-1 rounded-xl text-[10px] font-black uppercase ${mod.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                    {mod.isActive ? ts('active') : ts('inactive')}
                  </span>
                </div>
                <h3 className="font-black text-white text-lg">{mod.displayName}</h3>
                <p className="text-zinc-500 text-sm mt-1 leading-relaxed">{mod.description}</p>
                <div className="mt-4 pt-4 border-t border-zinc-800 flex justify-between items-center">
                  <span className="text-xs text-zinc-600 font-mono">{mod.name}</span>
                  <span className="text-sm font-black text-emerald-400">{ts('per_month', { price: mod.monthlyPrice })}</span>
                </div>
                <div className="mt-3 text-[10px] text-zinc-600 font-bold uppercase">
                  {ts('used_by', { count: tenants.filter((t: any) => (t.activeModuleIds || []).includes(mod.id) || (t.modules || []).some((m: any) => m.moduleId === mod.id && m.isEnabled)).length })}
                </div>
              </div>
            ))}
            {modules.length === 0 && (
              <div className="col-span-3 py-20 text-center text-zinc-600">
                <Package className="w-12 h-12 mx-auto mb-4 text-zinc-800" />
                <p>{ts('no_modules')}</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modals */}
      <ModuleManagementModal
        isOpen={isModuleModalOpen}
        onClose={() => { setModuleModalOpen(false); setSelectedTenant(null) }}
        tenant={selectedTenant}
        allModules={modules}
        onUpdate={refreshData}
      />
      <CreateTenantModal
        isOpen={isCreateTenantOpen}
        onClose={() => setCreateTenantOpen(false)}
        allModules={modules}
        onCreated={refreshData}
      />
      <CreateUserModal
        isOpen={isCreateUserOpen}
        onClose={() => setCreateUserOpen(false)}
        tenants={tenants}
        onCreated={refreshData}
      />
    </div>
  )
}
