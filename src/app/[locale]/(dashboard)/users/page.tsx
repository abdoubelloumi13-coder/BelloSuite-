'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Users, UserPlus, ShieldCheck, UserCheck, UserX, Search, KeyRound, X, Copy, RefreshCw } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { apiErrorMessage } from '@/lib/zod-helpers'

interface TenantUser {
  id: string; email: string; firstName: string | null; lastName: string | null; role: string
  isActive: boolean; createdAt: string; lastSignInAt: string | null; isSelf: boolean
}
interface Stats { total: number; active: number; inactive: number; admins: number }
type Filter = 'all' | 'active' | 'inactive' | 'admins'

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%*'
  const buf = new Uint32Array(14)
  crypto.getRandomValues(buf)
  return Array.from(buf, n => chars[n % chars.length]).join('')
}

export default function UsersPage() {
  const t = useTranslations('Settings.users_page')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [users, setUsers] = useState<TenantUser[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ user: TenantUser; action: 'deactivate' | 'demote' } | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''

  const load = useCallback(() => {
    if (!tenantId) return
    fetch(`/api/tenant/users${qs}`)
      .then(async r => {
        const j = await r.json().catch(() => null)
        if (!r.ok) { setError(apiErrorMessage(j, t('load_error'))); setUsers([]); return }
        setError('')
        setUsers(Array.isArray(j?.users) ? j.users : [])
        setStats(j?.stats ?? null)
      })
      .catch(() => { setError(t('load_error')); setUsers([]) })
  }, [tenantId, qs, t])

  useEffect(() => { load() }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (users ?? []).filter(u => {
      if (filter === 'active' && !u.isActive) return false
      if (filter === 'inactive' && u.isActive) return false
      if (filter === 'admins' && u.role !== 'ADMIN') return false
      if (!q) return true
      return [u.email, u.firstName, u.lastName].some(v => (v || '').toLowerCase().includes(q))
    })
  }, [users, query, filter])

  async function patch(u: TenantUser, body: Record<string, unknown>, okMsg: string) {
    setBusy(u.id); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/tenant/users/${u.id}${qs}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setError(apiErrorMessage(j, t('save_error'))); return }
      setNotice(okMsg); load()
    } catch { setError(t('save_error')) } finally { setBusy(null); setConfirm(null) }
  }

  async function resetPassword(u: TenantUser) {
    setBusy(u.id); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/tenant/users/${u.id}/reset-password${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale }) })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setError(apiErrorMessage(j, t('reset_error'))); return }
      setNotice(t('reset_sent', { email: u.email }))
    } catch { setError(t('reset_error')) } finally { setBusy(null) }
  }

  const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString(`${locale}-TN`) : '—'
  const name = (u: TenantUser) => [u.firstName, u.lastName].filter(Boolean).join(' ') || '—'

  const kpis: Array<{ key: Filter; label: string; value: number | undefined; icon: typeof Users }> = [
    { key: 'all', label: t('kpi_total'), value: stats?.total, icon: Users },
    { key: 'active', label: t('kpi_active'), value: stats?.active, icon: UserCheck },
    { key: 'admins', label: t('kpi_admins'), value: stats?.admins, icon: ShieldCheck },
    { key: 'inactive', label: t('kpi_inactive'), value: stats?.inactive, icon: UserX },
  ]

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-500/10 rounded-2xl"><Users className="w-6 h-6 text-teal-500" /></div>
          <div>
            <h1 className="text-3xl font-black text-stone-900 dark:text-white">{t('title')}</h1>
            <p className="text-stone-500 text-sm font-medium">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} title={t('refresh')} className="p-3 rounded-2xl border border-stone-200 dark:border-zinc-800 text-stone-500 hover:text-teal-600"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold">
            <UserPlus className="w-4 h-4" /> {t('add')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(k => (
          <button key={k.key} onClick={() => setFilter(k.key)}
            className={`text-start p-4 rounded-2xl border transition-all ${filter === k.key ? 'border-teal-500 bg-teal-500/5' : 'border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40'}`}>
            <k.icon className="w-4 h-4 text-teal-500 mb-2" />
            <div className="text-2xl font-black text-stone-900 dark:text-white">{k.value ?? '—'}</div>
            <div className="text-xs font-semibold text-stone-500">{k.label}</div>
          </button>
        ))}
      </div>

      {error && <div role="alert" className="p-4 rounded-2xl bg-red-50 text-red-700 border border-red-200 text-sm font-bold">{error}</div>}
      {notice && <div role="status" className="p-4 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-bold">{notice}</div>}

      {confirm && (
        <div className="p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 text-sm flex flex-wrap items-center justify-between gap-3">
          <span className="font-semibold">{confirm.action === 'deactivate' ? t('confirm_deactivate', { email: confirm.user.email }) : t('confirm_demote', { email: confirm.user.email })}</span>
          <div className="flex gap-2">
            <button onClick={() => setConfirm(null)} className="px-4 py-2 rounded-xl border border-amber-300 font-bold">{t('cancel')}</button>
            <button disabled={busy === confirm.user.id}
              onClick={() => confirm.action === 'deactivate'
                ? patch(confirm.user, { isActive: false }, t('deactivated'))
                : patch(confirm.user, { role: 'USER' }, t('role_changed'))}
              className="px-4 py-2 rounded-xl bg-amber-600 text-white font-bold disabled:opacity-50">{t('confirm')}</button>
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="w-4 h-4 absolute start-4 top-1/2 -translate-y-1/2 text-stone-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search')}
          className="w-full ps-11 pe-4 py-3 rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 text-sm" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40">
        <table className="w-full text-sm text-start">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-stone-500 bg-stone-50 dark:bg-zinc-800/30">
              <th className="px-5 py-3 text-start">{t('name')}</th>
              <th className="px-5 py-3 text-start">{t('email')}</th>
              <th className="px-5 py-3 text-start">{t('role')}</th>
              <th className="px-5 py-3 text-start">{t('status')}</th>
              <th className="px-5 py-3 text-start">{t('last_sign_in')}</th>
              <th className="px-5 py-3 text-start">{t('since')}</th>
              <th className="px-5 py-3 text-end">{t('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users === null ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-stone-400">{t('loading')}</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-stone-400">{t('empty')}</td></tr>
            ) : visible.map(u => (
              <tr key={u.id} className={`border-t border-stone-100 dark:border-zinc-800/50 ${u.isActive ? '' : 'opacity-60'}`}>
                <td className="px-5 py-3 font-semibold text-stone-900 dark:text-white">{name(u)}{u.isSelf && <span className="ms-2 text-[10px] font-bold text-teal-600">{t('you')}</span>}</td>
                <td className="px-5 py-3 text-stone-600 dark:text-zinc-300">{u.email}</td>
                <td className="px-5 py-3">
                  <select value={u.role === 'ADMIN' ? 'ADMIN' : 'USER'} disabled={u.isSelf || busy === u.id || !u.isActive}
                    onChange={e => e.target.value === 'USER' ? setConfirm({ user: u, action: 'demote' }) : patch(u, { role: 'ADMIN' }, t('role_changed'))}
                    className="px-2 py-1 rounded-lg bg-teal-50 dark:bg-zinc-800 text-teal-700 dark:text-teal-300 text-xs font-bold border-0 disabled:opacity-70">
                    <option value="ADMIN">{t('role_admin')}</option>
                    <option value="USER">{t('role_user')}</option>
                  </select>
                </td>
                <td className="px-5 py-3">{u.isActive ? <span className="text-emerald-600 font-semibold">{t('active')}</span> : <span className="text-stone-400">{t('inactive')}</span>}</td>
                <td className="px-5 py-3 text-stone-500">{u.lastSignInAt ? fmt(u.lastSignInAt) : t('never')}</td>
                <td className="px-5 py-3 text-stone-500">{fmt(u.createdAt)}</td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-2">
                    {u.isActive && (
                      <button disabled={busy === u.id} onClick={() => resetPassword(u)} title={t('reset_password')}
                        className="p-2 rounded-xl border border-stone-200 dark:border-zinc-700 text-stone-500 hover:text-teal-600 disabled:opacity-50"><KeyRound className="w-4 h-4" /></button>
                    )}
                    {!u.isSelf && (u.isActive ? (
                      <button disabled={busy === u.id} onClick={() => setConfirm({ user: u, action: 'deactivate' })}
                        className="px-3 py-2 rounded-xl border border-red-200 text-red-600 text-xs font-bold disabled:opacity-50">{t('deactivate')}</button>
                    ) : (
                      <button disabled={busy === u.id} onClick={() => patch(u, { isActive: true }, t('activated'))}
                        className="px-3 py-2 rounded-xl border border-emerald-200 text-emerald-600 text-xs font-bold disabled:opacity-50">{t('activate')}</button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">{t('hint')}</p>

      {showAdd && <AddUserDialog qs={qs} onClose={() => setShowAdd(false)} onCreated={email => { setShowAdd(false); setNotice(t('created', { email })); load() }} />}
    </div>
  )
}

function AddUserDialog({ qs, onClose, onCreated }: { qs: string; onClose: () => void; onCreated: (email: string) => void }) {
  const t = useTranslations('Settings.users_page')
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', role: 'USER', password: generatePassword() })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const r = await fetch(`/api/tenant/users${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const j = await r.json().catch(() => null)
      if (!r.ok) { setError(apiErrorMessage(j, t('save_error'))); return }
      onCreated(form.email)
    } catch { setError(t('save_error')) } finally { setSaving(false) }
  }

  const field = 'w-full px-4 py-3 rounded-xl border border-stone-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm'
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="w-full max-w-lg rounded-3xl bg-white dark:bg-zinc-900 p-6 space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black text-stone-900 dark:text-white">{t('add_title')}</h2>
          <button type="button" onClick={onClose} aria-label={t('cancel')}><X className="w-5 h-5 text-stone-400" /></button>
        </div>
        {error && <div role="alert" className="p-3 rounded-xl bg-red-50 text-red-700 text-sm font-bold">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <input className={field} placeholder={t('first_name')} value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
          <input className={field} placeholder={t('last_name')} value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
        </div>
        <input className={field} type="email" required placeholder={t('email')} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <select className={field} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
          <option value="USER">{t('role_user')} — {t('role_user_hint')}</option>
          <option value="ADMIN">{t('role_admin')} — {t('role_admin_hint')}</option>
        </select>
        <div>
          <label className="text-xs font-bold text-stone-500">{t('temp_password')}</label>
          <div className="flex gap-2 mt-1">
            <input className={`${field} font-mono`} required minLength={10} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
            <button type="button" onClick={() => { navigator.clipboard?.writeText(form.password); setCopied(true) }} title={t('copy')} className="px-3 rounded-xl border border-stone-200 dark:border-zinc-700"><Copy className="w-4 h-4" /></button>
            <button type="button" onClick={() => { setForm({ ...form, password: generatePassword() }); setCopied(false) }} title={t('generate')} className="px-3 rounded-xl border border-stone-200 dark:border-zinc-700"><RefreshCw className="w-4 h-4" /></button>
          </div>
          <p className="text-xs text-stone-500 mt-1">{copied ? t('copied') : t('temp_password_hint')}</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-5 py-3 rounded-2xl border border-stone-200 dark:border-zinc-700 text-sm font-bold">{t('cancel')}</button>
          <button disabled={saving} className="px-5 py-3 rounded-2xl bg-teal-600 text-white text-sm font-bold disabled:opacity-50">{saving ? t('saving') : t('create')}</button>
        </div>
      </form>
    </div>
  )
}
