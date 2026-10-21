'use client'

import { useState, useEffect, useMemo } from 'react'
import { Link } from '@/i18n/routing'
import { useTranslations, useLocale } from 'next-intl'
import {
  Search, Filter, Download, Plus, FileText, Calendar,
  User, Printer, ExternalLink, FileCode, Edit, Trash2,
  ChevronDown, X, RefreshCw
} from 'lucide-react'

interface DocumentListProps {
  tenantId: string
  type: string // QUOTE | ORDER | DELIVERY_NOTE | INVOICE | CREDIT_NOTE | SUPPLIER_ORDER | SUPPLIER_INVOICE
  title?: string
  documentLabel?: string // e.g. "Devis", "Bon de Commande"
  accentColor: string // tailwind color class e.g. "emerald"
  apiEndpoint: string // e.g. "/api/commercial/invoices"
  newHref: string
  showSupplier?: boolean
}

const STATUS_OPTIONS = ['TOUT', 'DRAFT', 'PENDING', 'CONFIRMED', 'SENT', 'PAID', 'CANCELLED']
const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-stone-100 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400',
  PENDING: 'bg-amber-100 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400',
  CONFIRMED: 'bg-blue-100 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400',
  SENT: 'bg-purple-100 dark:bg-purple-500/10 text-purple-700 dark:text-purple-400',
  PAID: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  CANCELLED: 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400',
}

export default function DocumentList({
  tenantId, type, title, documentLabel, accentColor,
  apiEndpoint, newHref, showSupplier = false
}: DocumentListProps) {
  const t = useTranslations('Commercial.DocumentList')
  const dt = useTranslations('Commercial.DocumentTypes')
  const locale = useLocale()
  
  const [docs, setDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('TOUT')
  const [showFilters, setShowFilters] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const docName = dt(type)
  const statusLabel = (s: string) => (dt.has(`STATUS.${s}`) ? dt(`STATUS.${s}`) : s)
  const displayTitle = title || docName

  const fetchDocs = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tenantId })
      if (type) params.set('type', type)
      if (status !== 'TOUT') params.set('status', status)
      const res = await fetch(`${apiEndpoint}?${params}`)
      if (res.ok) setDocs(await res.json())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (tenantId) fetchDocs() }, [tenantId, status])

  const filtered = useMemo(() => {
    if (!search && !dateFrom && !dateTo) return docs
    const q = search.toLowerCase()
    return docs.filter(d => {
      const matchSearch = !search || (
        d.number?.toLowerCase().includes(q) ||
        d.client?.name?.toLowerCase().includes(q) ||
        d.supplier?.name?.toLowerCase().includes(q)
      )
      const docDate = new Date(d.date)
      const matchDateFrom = !dateFrom || docDate >= new Date(dateFrom)
      const matchDateTo = !dateTo || docDate <= new Date(dateTo)
      return matchSearch && matchDateFrom && matchDateTo
    })
  }, [docs, search, dateFrom, dateTo])

  const stats = useMemo(() => ({
    total: filtered.length,
    totalTTC: filtered.reduce((s, d) => s + Number(d.totalTTC || 0), 0),
    paid: filtered.filter(d => d.status === 'PAID').reduce((s, d) => s + Number(d.totalTTC || 0), 0),
    unpaid: filtered.filter(d => d.status !== 'PAID' && d.status !== 'CANCELLED').reduce((s, d) => s + Number(d.totalTTC || 0), 0),
  }), [filtered])

  const color = accentColor || 'teal'
  const colorMap: Record<string, { bg: string; border: string; hover: string }> = {
    emerald: { bg: 'bg-emerald-600', border: 'border-emerald-500/50', hover: 'hover:bg-emerald-500' },
    teal: { bg: 'bg-teal-600', border: 'border-teal-500/50', hover: 'hover:bg-teal-500' },
    amber: { bg: 'bg-amber-600', border: 'border-amber-500/50', hover: 'hover:bg-amber-500' },
    blue: { bg: 'bg-blue-600', border: 'border-blue-500/50', hover: 'hover:bg-blue-500' },
    purple: { bg: 'bg-purple-600', border: 'border-purple-500/50', hover: 'hover:bg-purple-500' },
  }
  const c = colorMap[color] || colorMap.teal

  const handleDelete = async (id: string) => {
    if (!confirm(t('actions.delete_prompt', { label: docName }))) return
    await fetch(`${apiEndpoint}/${id}`, { method: 'DELETE' })
    fetchDocs()
  }

  const fmt = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-TN' : 'fr-TN', { 
    maximumFractionDigits: 3 
  })

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto text-start">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-stone-900 dark:text-white tracking-tight">{displayTitle}</h1>
          <p className="text-stone-500 dark:text-zinc-400 font-medium mt-1">
            {stats.total} {docName}s — {t('ttc_total')}: {fmt(stats.totalTTC)} {t('dt')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchDocs} className="p-2.5 border border-stone-200 dark:border-zinc-800 rounded-xl hover:bg-stone-50 dark:hover:bg-zinc-800 text-stone-500 transition-all shadow-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 border border-stone-200 dark:border-zinc-800 rounded-xl hover:bg-stone-50 dark:hover:bg-zinc-800 text-stone-600 dark:text-zinc-400 font-bold text-sm shadow-sm">
            <Download className="w-4 h-4" /> {t('export')}
          </button>
          <Link href={newHref}
            className={`flex items-center gap-2 px-5 py-2.5 ${c.bg} text-white rounded-xl font-bold text-sm shadow-lg ${c.hover} transition-all`}>
            <Plus className="w-4 h-4" /> {t('new_document', { label: docName })}
          </Link>
        </div>
      </div>

      {/* Mini Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 p-6 text-center shadow-sm">
          <p className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('stats.total')}</p>
          <p className="text-xl font-black text-stone-900 dark:text-white mt-1">{fmt(stats.totalTTC)} <span className="text-xs text-stone-400 dark:text-zinc-500">{t('dt')}</span></p>
        </div>
        <div className="bg-emerald-50 dark:bg-emerald-500/5 rounded-2xl border border-emerald-200 dark:border-emerald-500/20 p-6 text-center shadow-sm">
          <p className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 uppercase tracking-widest">{t('stats.paid')}</p>
          <p className="text-xl font-black text-emerald-700 dark:text-emerald-400 mt-1">{fmt(stats.paid)} <span className="text-xs text-emerald-400/60 dark:text-emerald-500/40">{t('dt')}</span></p>
        </div>
        <div className="bg-amber-50 dark:bg-amber-500/5 rounded-2xl border border-amber-200 dark:border-amber-500/20 p-6 text-center shadow-sm">
          <p className="text-[10px] font-black text-amber-600 dark:text-amber-500 uppercase tracking-widest">{t('stats.pending')}</p>
          <p className="text-xl font-black text-amber-700 dark:text-amber-400 mt-1">{fmt(stats.unpaid)} <span className="text-xs text-amber-400/60 dark:text-amber-500/40">{t('dt')}</span></p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 group">
          <Search className="w-5 h-5 absolute inset-inline-start-3.5 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-teal-500 transition-colors" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('search_placeholder', { target: showSupplier ? t('table.supplier') : t('table.client') })}
            className="w-full ps-11 pe-4 py-2.5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl text-sm text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500/10 focus:border-teal-500 outline-none shadow-sm transition-all text-start" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="ps-3 pe-8 py-2.5 border border-stone-200 dark:border-zinc-800 rounded-xl text-sm font-bold text-stone-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 shadow-sm appearance-none cursor-pointer hover:bg-stone-50 dark:hover:bg-zinc-800 transition-all">
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s === 'TOUT' ? t('filter_status') : statusLabel(s)}</option>)}
          </select>
          <button onClick={() => setShowFilters(!showFilters)}
            className={`p-2.5 border rounded-xl text-sm font-bold transition-all shadow-sm ${showFilters ? `${c.bg} text-white border-transparent` : 'border-stone-200 dark:border-zinc-800 text-stone-600 dark:text-zinc-400 bg-white dark:bg-zinc-900 hover:bg-stone-50 dark:hover:bg-zinc-800'}`}>
            <Filter className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Date Filters */}
      {showFilters && (
        <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 p-6 flex flex-wrap gap-6 items-end shadow-sm">
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest block">{t('filter_from')}</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="px-4 py-2 bg-stone-50/50 dark:bg-zinc-950/50 border border-stone-200 dark:border-zinc-800 rounded-xl text-sm text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500/10 outline-none transition-all" />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest block">{t('filter_to')}</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="px-4 py-2 bg-stone-50/50 dark:bg-zinc-950/50 border border-stone-200 dark:border-zinc-800 rounded-xl text-sm text-stone-900 dark:text-white focus:ring-2 focus:ring-teal-500/10 outline-none transition-all" />
          </div>
          <button onClick={() => { setDateFrom(''); setDateTo('') }}
            className="px-4 py-2 text-xs font-bold text-stone-500 dark:text-zinc-500 hover:text-stone-700 dark:hover:text-zinc-300 transition-colors uppercase tracking-widest">{t('reset')}</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 shadow-sm overflow-hidden transition-all">
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="bg-stone-50 dark:bg-zinc-800/50 border-b border-stone-100 dark:border-zinc-800/80 text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">
                <th className="px-6 py-4 text-start">{t('table.reference')}</th>
                <th className="px-6 py-4 text-start">{showSupplier ? t('table.supplier') : t('table.client')}</th>
                <th className="px-6 py-4 text-start">{t('table.date')}</th>
                <th className="px-6 py-4 text-start">{t('table.due_date')}</th>
                <th className="px-6 py-4 text-end">{t('table.amount_ht')}</th>
                <th className="px-6 py-4 text-end">{t('table.tva')}</th>
                <th className="px-6 py-4 text-end">{t('table.amount_ttc')}</th>
                <th className="px-6 py-4 text-start">{t('table.status')}</th>
                <th className="px-6 py-4 text-end">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/50">
              {loading ? (
                <tr><td colSpan={10} className="px-6 py-16 text-center text-stone-400 dark:text-zinc-600 font-bold text-sm tracking-tight">{t('loading')}</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-6 py-16 text-center text-stone-400 dark:text-zinc-600 font-bold text-sm tracking-tight">{t('no_docs_found', { label: docName })}</td></tr>
              ) : filtered.map(doc => (
                <tr key={doc.id} className="hover:bg-stone-50/80 dark:hover:bg-zinc-800/30 transition-all group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3 text-start">
                      <div className="w-9 h-9 rounded-xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center border border-stone-200 dark:border-zinc-700/50 group-hover:border-teal-500/30 transition-all">
                        <FileText className="w-4 h-4 text-stone-400 dark:text-zinc-500" />
                      </div>
                      <div>
                        <p className="font-bold text-stone-900 dark:text-white text-sm font-mono uppercase">{doc.number}</p>
                        <p className="text-[10px] text-stone-400 dark:text-zinc-600 uppercase font-black">{doc.type}</p>
                        {doc.warehouse && (
                          <p className="text-[10px] text-stone-500 dark:text-zinc-500 font-bold">{t('warehouse', { name: doc.warehouse.name })}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-stone-600 dark:text-zinc-400 font-medium text-start">
                    {showSupplier ? doc.supplier?.name : doc.client?.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-stone-500 dark:text-zinc-500 text-start">
                    {new Date(doc.date).toLocaleDateString(locale === 'ar' ? 'ar-TN' : 'fr-TN')}
                  </td>
                  <td className="px-6 py-4 text-sm text-start">
                    {doc.dueDate ? (
                      <span className={`font-bold ${new Date(doc.dueDate) < new Date() ? 'text-red-600 dark:text-red-500' : 'text-stone-500 dark:text-zinc-500'}`}>
                        {new Date(doc.dueDate).toLocaleDateString(locale === 'ar' ? 'ar-TN' : 'fr-TN')}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-6 py-4 text-end font-mono font-bold text-stone-700 dark:text-zinc-400 text-sm">{fmt(Number(doc.subtotalHT || 0))}</td>
                  <td className="px-6 py-4 text-end font-mono font-bold text-stone-500 dark:text-zinc-500 text-sm">{fmt(Number(doc.totalVAT || 0))}</td>
                  <td className="px-6 py-4 text-end font-black text-stone-900 dark:text-white font-mono text-sm leading-none">
                    <div className="flex flex-col items-end">
                      <span>{fmt(Number(doc.totalTTC || 0))}</span>
                      <span className="text-[9px] text-stone-400 dark:text-zinc-600 uppercase tracking-tighter mt-0.5">{t('dt')}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-start">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${STATUS_COLORS[doc.status] || STATUS_COLORS.DRAFT}`}>
                      {statusLabel(doc.status)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-end">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                      {doc.status !== 'PAID' && doc.status !== 'CANCELLED' && (
                        <button className="p-2 bg-stone-50 dark:bg-zinc-800 hover:bg-teal-50 dark:hover:bg-teal-500/10 text-stone-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-lg transition-all border border-transparent hover:border-teal-500/10" title={t('actions.edit')}>
                          <Edit className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => handleDelete(doc.id)} className="p-2 bg-stone-50 dark:bg-zinc-800 hover:bg-red-50 dark:hover:bg-red-500/10 text-stone-400 hover:text-red-600 dark:hover:text-red-400 rounded-lg transition-all border border-transparent hover:border-red-500/10" title={t('actions.delete')}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}