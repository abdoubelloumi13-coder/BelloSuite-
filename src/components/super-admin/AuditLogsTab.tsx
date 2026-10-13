'use client'

import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, Download } from 'lucide-react'
import { useTranslations } from 'next-intl'
import SmartInput from '@/components/ui/SmartInput'
import type { Suggestion } from '@/components/ui/SmartInput'

interface AuditLog {
  id: string
  action: string
  target: string | null
  targetId: string | null
  details: unknown
  ip: string | null
  createdAt: string
  admin: { id: string; email: string; firstName: string; lastName: string } | null
  tenant: { id: string; name: string; subdomain: string } | null
}

const PAGE_SIZE = 50

export default function AuditLogsTab() {
  const t = useTranslations('SuperAdmin.auditLogs')
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [actionFilter, setActionFilter] = useState('')
  const [tenantFilter, setTenantFilter] = useState('')
  const [actions, setActions] = useState<Suggestion[]>([])
  const [tenants, setTenants] = useState<Suggestion[]>([])

  const fetchLogs = async (p: number = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(p),
        limit: String(PAGE_SIZE),
      })
      if (actionFilter) params.set('action', actionFilter)
      if (tenantFilter) params.set('tenantId', tenantFilter)
      const res = await fetch(`/api/super-admin/audit-logs?${params}`)
      if (res.ok) {
        const data = await res.json()
        setLogs(data.logs || [])
        setTotal(data.total || 0)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  // Options de filtre
  useEffect(() => {
    fetch('/api/super-admin/audit-logs?limit=100')
      .then(r => (r.ok ? r.json() : { logs: [] }))
      .then((d: { logs: AuditLog[] }) => {
        const uniq = [...new Set((d.logs || []).map(l => l.action).filter(Boolean))] as string[]
        setActions(uniq.sort())
      })
      .catch(() => {})
    fetch('/api/super-admin/tenants')
      .then(r => (r.ok ? r.json() : []))
      .then((list: any[]) => {
        setTenants(
          (Array.isArray(list) ? list : []).map((x: any) => ({
            value: x.id,
            label: `${x.name} (${x.subdomain})`,
          }))
        )
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    setPage(1)
  }, [actionFilter, tenantFilter])

  useEffect(() => {
    fetchLogs(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, actionFilter, tenantFilter])

  const actionLabels: Record<string, string> = {
    TENANT_ACTIVATE: 'Tenant activé',
    TENANT_SUSPEND: 'Tenant suspendu',
    TENANT_DELETE_HARD: 'Tenant supprimé (hard)',
    USER_ACTIVATE: 'User activé',
    USER_DEACTIVATE: 'User désactivé',
    USER_DELETE_HARD: 'User supprimé (hard)',
    USER_ROLE_CHANGE: 'Rôle user modifié',
    IMPERSONATE_START: 'Impersonation démarrée',
    IMPERSONATE_END: 'Impersonation terminée',
  }

  const from = (page - 1) * PAGE_SIZE + 1
  const to = Math.min(page * PAGE_SIZE, total)

  return (
    <div className="space-y-6">
      {/* Filtres */}
      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[2rem] p-6">
        <h3 className="font-black text-white text-lg mb-4">{t('filters')}</h3>
        <div className="flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[220px] space-y-1">
            <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest">{t('filter_action')}</label>
            <SmartInput
              value={actionFilter}
              onChange={(v: string) => setActionFilter(v)}
              suggestions={actions}
              placeholder={t('all_actions')}
              inputClassName="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white outline-none focus:border-emerald-500 transition-all"
            />
          </div>
          <div className="flex-1 min-w-[220px] space-y-1">
            <label className="block text-[9px] font-black text-zinc-500 uppercase tracking-widest">{t('filter_tenant')}</label>
            <SmartInput
              value={tenantFilter}
              onChange={(v: string) => setTenantFilter(v)}
              suggestions={tenants}
              placeholder={t('all_tenants')}
              inputClassName="w-full px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-xl text-sm text-white outline-none focus:border-emerald-500 transition-all"
            />
          </div>
          <button
            onClick={() => fetchLogs(page)}
            className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl text-xs transition-all"
          >
            <RefreshCw className="w-4 h-4" /> {t('refresh')}
          </button>
          <button className="flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-xl text-xs transition-all" title="Export CSV (bientôt)">
            <Download className="w-4 h-4" /> {t('export')}
          </button>
        </div>
      </div>

      {/* Tableau */}
      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[2rem] overflow-hidden">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <table className="w-full">
            <thead>
              <tr className="bg-zinc-800/30 border-b border-zinc-800/50">
                <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('action')}</th>
                <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('target')}</th>
                <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('admin')}</th>
                <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('tenant')}</th>
                <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('date')}</th>
                <th className="px-6 py-4 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/30">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-16 text-center text-zinc-600 font-medium animate-pulse">{t('loading')}</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-16 text-center text-zinc-600 font-medium">{t('no_logs')}</td></tr>
              ) : (
                logs.map(l => (
                  <tr key={l.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                        l.action.includes('DELETE') ? 'bg-red-500/10 text-red-400' :
                        l.action.includes('SUSPEND') || l.action.includes('DEACTIVATE') ? 'bg-amber-500/10 text-amber-400' :
                        l.action.includes('IMPERSONATE') ? 'bg-purple-500/10 text-purple-400' :
                        'bg-emerald-500/10 text-emerald-400'
                      }`}>
                        {actionLabels[l.action] || l.action}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-300">
                      {l.target ? `${l.target} (${l.targetId?.slice(0, 8)}…)` : '—'}
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-zinc-300">{l.admin ? `${l.admin.firstName} ${l.admin.lastName}` : '—'}</p>
                      {l.admin && <p className="text-[10px] text-zinc-500">{l.admin.email}</p>}
                    </td>
                    <td className="px-6 py-4 text-sm text-zinc-300">
                      {l.tenant ? `${l.tenant.name} (${l.tenant.subdomain})` : '—'}
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-500 whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString('fr-TN')}
                    </td>
                    <td className="px-6 py-4 text-xs text-zinc-500 font-mono max-w-xs truncate">
                      {l.details ? JSON.stringify(l.details) : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-zinc-800/30 flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-400">
            {total === 0 ? t('no_results') : t('showing', { from, to, total })}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1 || loading}
              className="p-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page * PAGE_SIZE >= total || loading}
              className="p-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}