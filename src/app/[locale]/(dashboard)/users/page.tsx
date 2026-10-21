'use client'

import { useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Users } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { apiErrorMessage } from '@/lib/zod-helpers'

interface TenantUser { id: string; email: string; firstName: string | null; lastName: string | null; role: string; isActive: boolean; createdAt: string }

export default function UsersPage() {
  const t = useTranslations('Settings.users_page')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [users, setUsers] = useState<TenantUser[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!tenantId) return
    fetch(`/api/tenant/users?tenantId=${encodeURIComponent(tenantId)}`)
      .then(async r => {
        const j = await r.json().catch(() => null)
        if (!r.ok) { setError(apiErrorMessage(j, t('load_error'))); setUsers([]); return }
        setUsers(Array.isArray(j) ? j : [])
      })
      .catch(() => { setError(t('load_error')); setUsers([]) })
  }, [tenantId, t])

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-teal-500/10 rounded-2xl"><Users className="w-6 h-6 text-teal-500" /></div>
        <div>
          <h1 className="text-3xl font-black text-stone-900 dark:text-white">{t('title')}</h1>
          <p className="text-stone-500 text-sm font-medium">{t('subtitle')}</p>
        </div>
      </div>
      {error && <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-700 border border-red-200 text-sm font-bold">{error}</div>}
      <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40">
        <table className="w-full text-sm text-start">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-stone-500 bg-stone-50 dark:bg-zinc-800/30">
              <th className="px-5 py-3 text-start">{t('name')}</th>
              <th className="px-5 py-3 text-start">{t('email')}</th>
              <th className="px-5 py-3 text-start">{t('role')}</th>
              <th className="px-5 py-3 text-start">{t('status')}</th>
              <th className="px-5 py-3 text-start">{t('since')}</th>
            </tr>
          </thead>
          <tbody>
            {users === null ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-stone-400">{t('loading')}</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-stone-400">{t('empty')}</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-t border-stone-100 dark:border-zinc-800/50">
                <td className="px-5 py-3 font-semibold text-stone-900 dark:text-white">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-5 py-3 text-stone-600 dark:text-zinc-300">{u.email}</td>
                <td className="px-5 py-3"><span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-700 text-xs font-bold">{u.role === 'ADMIN' || u.role === 'SUPER_ADMIN' ? t('role_admin') : t('role_user')}</span></td>
                <td className="px-5 py-3">{u.isActive ? <span className="text-emerald-600 font-semibold">{t('active')}</span> : <span className="text-stone-400">{t('inactive')}</span>}</td>
                <td className="px-5 py-3 text-stone-500">{new Date(u.createdAt).toLocaleDateString(`${locale}-TN`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">{t('hint')}</p>
    </div>
  )
}
