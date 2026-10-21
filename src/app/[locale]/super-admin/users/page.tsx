'use client'

import { useState, useEffect, useRef } from 'react'
import { 
  Users, 
  Search, 
  Filter, 
  Trash2, 
  ShieldCheck, 
  ShieldAlert, 
  Activity, 
  Building2,
  Mail,
  MoreHorizontal
} from 'lucide-react'
import Header from '../Header'
import gsap from 'gsap'
import { useTranslations, useLocale } from 'next-intl'

export default function UsersManagementPage() {
  const t = useTranslations('SuperAdmin.users')
  const locale = useLocale()
  const [users, setUsers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterTenant, setFilterTenant] = useState('')
  const tableRef = useRef(null)

  const fetchUsers = async () => {
    setLoading(true)
    try {
      // Route protégée (requireSuperAdmin) — plus de Server Action sans contrôle d'accès
      const params = new URLSearchParams()
      if (filterTenant) params.set('tenantId', filterTenant)
      if (search) params.set('q', search)
      const res = await fetch(`/api/super-admin/users?${params.toString()}`)
      const data = res.ok ? await res.json() : []
      setUsers(Array.isArray(data) ? data : [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [search, filterTenant])

  useEffect(() => {
    if (!loading) {
      gsap.fromTo('.user-row', 
        { y: 10, opacity: 0 }, 
        { y: 0, opacity: 1, duration: 0.4, stagger: 0.05, ease: 'power2.out' }
      )
    }
  }, [loading])

  const handleToggleStatus = async (userId: string, currentStatus: boolean) => {
    try {
      const res = await fetch(`/api/super-admin/users/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentStatus }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Échec')
      fetchUsers()
    } catch (error) {
      console.error('Failed to toggle user status:', error)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white pb-20">
      {/* Reusable Header from Super Admin */}
      <Header title={t('title')} subtitle={t('subtitle')} />

      <main className="max-w-7xl mx-auto px-8 mt-10">
       
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8 bg-zinc-900/40 p-4 rounded-3xl border border-zinc-800/50 backdrop-blur-xl">
           <div className="flex items-center gap-4 flex-1 min-w-[300px]">
              <div className="relative flex-1 group">
                 <Search className="w-5 h-5 absolute start-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-emerald-500 transition-colors" />
                 <input 
                    type="text" 
                    placeholder={t('search')} 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl py-3 ps-11 pe-4 text-sm font-medium outline-none focus:border-emerald-500/50 transition-all"
                 />
              </div>
              <button className="p-3 bg-zinc-950 border border-zinc-800 rounded-2xl text-zinc-500 hover:text-white hover:border-zinc-700 transition-all">
                 <Filter className="w-5 h-5" />
              </button>
           </div>
           <div className="flex items-center gap-3">
              <span className="text-xs font-black text-zinc-600 uppercase tracking-widest">{users.length} Comptes actifs</span>
              <button className="px-5 py-3 bg-white text-zinc-950 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-emerald-50 transition-all">{t('new')}</button>
           </div>
        </div>

        {/* Users Table */}
        <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[2.5rem] overflow-hidden backdrop-blur-xl shadow-2xl">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full border-collapse">
            <thead>
              <tr className="bg-zinc-800/30 text-start border-b border-zinc-800/50">
                <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{t('user')}</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{t('tenant')}</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{t('role')}</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{t('last_login')}</th>
                <th className="px-6 py-5 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{t('status')}</th>
                <th className="px-8 py-5 text-end text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse opacity-50">
                    <td colSpan={6} className="px-8 py-8"><div className="h-6 bg-zinc-800 rounded-lg w-full" /></td>
                  </tr>
                ))
              ) : users.map((user) => (
                <tr key={user.id} className="user-row group hover:bg-white/5 transition-colors">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white font-black text-lg border-2 border-zinc-950 shadow-xl group-hover:scale-110 transition-transform">
                        {user.firstName?.charAt(0) || user.email.charAt(0)}
                      </div>
                      <div>
                        <p className="text-white font-bold tracking-tight">{user.firstName || t('user')} {user.lastName || ''}</p>
                        <div className="flex items-center gap-1.5 text-zinc-500 text-[10px] uppercase font-black">
                          <Mail className="w-3 h-3 text-emerald-500" />
                          {user.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                     {user.tenant ? (
                       <div className="flex items-center gap-2">
                         <Building2 className="w-4 h-4 text-zinc-500" />
                         <span className="text-sm font-bold text-zinc-300">{user.tenant.name}</span>
                       </div>
                     ) : (
                       <span className="text-[10px] font-black uppercase text-red-500 bg-red-500/10 px-2 py-1 rounded-lg">{t('no_tenant')}</span>
                     )}
                  </td>
                  <td className="px-6 py-5">
                     <span className={`px-3 py-1 rounded-xl text-[10px] font-black uppercase tracking-tighter ${
                       user.role === 'SUPER_ADMIN' ? 'bg-red-500/10 text-red-400' :
                       user.role === 'ADMIN' ? 'bg-amber-500/10 text-amber-400' :
                       'bg-zinc-800 text-zinc-400'
                     }`}>
                       {user.role}
                     </span>
                  </td>
                  <td className="px-6 py-5">
                     <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-black uppercase">
                       <Activity className="w-3 h-3 text-emerald-500" />
                       {new Date(user.createdAt).toLocaleDateString(`${locale}-TN`)}
                     </div>
                  </td>
                  <td className="px-6 py-5">
                     <button 
                       onClick={() => handleToggleStatus(user.id, user.isActive)}
                       className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all ${
                         user.isActive 
                         ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20' 
                         : 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
                       }`}
                     >
                       {user.isActive ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                       <span className="text-[10px] font-black uppercase">{user.isActive ? t('active') : t('disabled')}</span>
                     </button>
                  </td>
                  <td className="px-8 py-5 text-end">
                    <button className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-500 hover:text-white transition-all">
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && users.length === 0 && (
            <div className="p-20 text-center">
              <div className="w-20 h-20 bg-zinc-900 rounded-full flex items-center justify-center mx-auto mb-4 border border-zinc-800">
                <Users className="w-10 h-10 text-zinc-700" />
              </div>
              <h3 className="font-black text-white text-lg">{t('empty_title')}</h3>
              <p className="text-zinc-500 font-medium">{t('empty_desc')}</p>
            </div>
          )}
        </div>
      </div>
      </main>
    </div>
  )
}