'use client'
import { useState, useEffect, useCallback } from 'react'
import { Link } from '@/i18n/routing'
import {
  UserPlus, Search, Upload, Users, Phone, Mail, MapPin,
  ChevronRight, Building2, Calendar, X
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useTranslations, useLocale } from 'next-intl'
import { readApiError } from '@/lib/client-errors'

const STATUSES = [
  { key: 'NOUVEAU', color: 'border-stone-400', badge: 'bg-stone-100 text-stone-600' },
  { key: 'CONTACTE', color: 'border-blue-400', badge: 'bg-blue-100 text-blue-700' },
  { key: 'DEMO', color: 'border-violet-400', badge: 'bg-violet-100 text-violet-700' },
  { key: 'NEGOCIATION', color: 'border-amber-400', badge: 'bg-amber-100 text-amber-700' },
  { key: 'GAGNE', color: 'border-teal-500', badge: 'bg-teal-100 text-teal-700' },
  { key: 'PERDU', color: 'border-red-300', badge: 'bg-red-100 text-red-600' },
]

function LeadCard({ lead }: { lead: any }) {
  const t = useTranslations('CRM')
  const locale = useLocale()
  const sector = t.has(`sectors.${lead.sector}`) ? t(`sectors.${lead.sector}`) : t('sectors.AUTRE')
  return (
    <Link href={`/crm/leads/${lead.id}`}
      className="bg-white border border-stone-200 rounded-xl p-3 hover:shadow-md hover:border-teal-300 transition-all group block">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-black text-stone-900 text-xs truncate">{lead.name}</p>
          {lead.company && (
            <p className="flex items-center gap-1 text-stone-500 text-[10px] font-bold mt-0.5 truncate">
              <Building2 className="w-3 h-3 shrink-0" /> {lead.company}
            </p>
          )}
        </div>
        <span className={`shrink-0 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${SECTOR_BADGE[lead.sector] || 'bg-stone-100 text-stone-500'}`}>
          {sector.split(' ')[0]}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2.5 text-[10px] font-bold text-stone-500">
        {lead.city && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{lead.city}</span>}
        {lead.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{lead.phone}</span>}
        {lead.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" />{lead.email}</span>}
      </div>
      <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-stone-100">
        {lead.estimatedValue ? (
          <span className="text-xs font-black text-teal-700">{Number(lead.estimatedValue).toLocaleString(`${locale}-TN`)} DT</span>
        ) : <span />}
        {lead.nextFollowUp && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600">
            <Calendar className="w-3 h-3" />
            {new Date(lead.nextFollowUp).toLocaleDateString(`${locale}-TN`, { day: '2-digit', month: 'short' })}
          </span>
        )}
      </div>
    </Link>
  )
}

const SECTOR_BADGE: Record<string, string> = {
  GARAGE: 'bg-orange-50 text-orange-600', PME_INDUSTRIE: 'bg-blue-50 text-blue-600',
  COMMERCE: 'bg-pink-50 text-pink-600', SERVICES: 'bg-indigo-50 text-indigo-600',
  AUTO_ENTREPRENEUR: 'bg-teal-50 text-teal-600', AUTRE: 'bg-stone-100 text-stone-500',
}

export default function CrmPipelinePage() {
  const t = useTranslations('CRM')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [leads, setLeads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showImport, setShowImport] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return }
    try {
      const r = await fetch(`/api/crm/leads?tenantId=${tenantId}${search ? `&search=${encodeURIComponent(search)}` : ''}`)
      if (!r.ok) { setError(await readApiError(r, locale)); return }
      const data = await r.json()
      setLeads(Array.isArray(data) ? data : [])
      setError(null)
    } catch {
      setError(t('pipeline.load_error'))
    } finally {
      setLoading(false)
    }
  }, [tenantId, search, locale, t])

  useEffect(() => { load() }, [load])

  const handleImport = async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('tenantId', tenantId || '')
    setImporting(true)
    try {
      const r = await fetch('/api/crm/leads/import', { method: 'POST', body: fd })
      if (!r.ok) {
        setImportResult({ imported: 0, failed: 0, errors: [], message: await readApiError(r, locale) })
        return
      }
      setImportResult(await r.json())
      load()
    } catch {
      setImportResult({ imported: 0, failed: 0, errors: [], message: t('import.error') })
    } finally {
      setImporting(false)
    }
  }

  const byStatus = (key: string) => leads.filter(l => l.status === key)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-stone-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-teal-600" /> {t('pipeline.title')}
          </h1>
          <p className="text-stone-500 text-sm font-bold mt-0.5">{t('pipeline.total', { count: leads.length })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-stone-400 absolute start-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('pipeline.search')}
              className="ps-9 pe-3 py-2 text-sm border border-stone-200 rounded-xl bg-white w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
            />
          </div>
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-bold border border-stone-200 rounded-xl bg-white hover:bg-stone-50 text-stone-700">
            <Upload className="w-4 h-4" /> {t('pipeline.import')}
          </button>
          <Link href="/crm/leads/new"
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl">
            <UserPlus className="w-4 h-4" /> {t('pipeline.new')}
          </Link>
        </div>
      </div>

      {error && <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>}

      {/* Kanban */}
      {loading ? (
        <div className="flex items-center justify-center py-24 text-stone-400 font-bold">{t('pipeline.loading')}</div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 -mx-1 px-1">
          {STATUSES.map(s => {
            const items = byStatus(s.key)
            const total = items.reduce((sum, l) => sum + (Number(l.estimatedValue) || 0), 0)
            return (
              <div key={s.key} className="flex-1 min-w-[260px] max-w-[320px]">
                <div className={`flex items-center gap-2 px-3 py-2.5 rounded-t-2xl border-t-[3px] bg-stone-50 ${s.color}`}>
                  <span className="font-black text-xs text-stone-700">{t(`statuses.${s.key}`)}</span>
                  <span className="ms-auto px-2 py-0.5 bg-white rounded-full text-[10px] font-black text-stone-500 border border-stone-200">
                    {items.length}
                  </span>
                </div>
                <div className="bg-stone-50/50 border border-t-0 border-stone-200 rounded-b-2xl p-2.5 space-y-2 min-h-[120px] max-h-[70vh] overflow-y-auto">
                  {items.length === 0 ? (
                    <p className="text-stone-300 text-[10px] font-bold text-center py-8">{t('pipeline.empty_column')}</p>
                  ) : items.map(lead => (
                    <LeadCard key={lead.id} lead={lead} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => { setShowImport(false); setImportResult(null) }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-black text-stone-900 text-lg">{t('import.title')}</h2>
              <button onClick={() => { setShowImport(false); setImportResult(null) }}><X className="w-5 h-5 text-stone-400" /></button>
            </div>
            <p className="text-sm text-stone-500 font-bold mb-3">
              {t('import.columns')} <code className="text-xs bg-stone-100 px-1 rounded">code, name, company, email, phone, address, city, sector, source, status, estimatedValue</code>
            </p>
            {importResult?.message ? (
              <p role="alert" className="text-sm font-bold text-red-600">{importResult.message}</p>
            ) : importResult ? (
              <div className="space-y-2">
                <div className="flex gap-3">
                  <div className="flex-1 bg-teal-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-teal-700">{importResult.imported}</p>
                    <p className="text-[10px] font-bold text-teal-600">{t('import.imported')}</p>
                  </div>
                  <div className="flex-1 bg-red-50 rounded-xl p-3 text-center">
                    <p className="text-2xl font-black text-red-600">{importResult.failed}</p>
                    <p className="text-[10px] font-bold text-red-500">{t('import.failed')}</p>
                  </div>
                </div>
                {importResult.errors?.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {importResult.errors.map((e: any, i: number) => (
                      <p key={i} className="text-[10px] text-red-600 font-bold">{t('import.row_error', { row: e.row, error: e.error })}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : importing ? (
              <p className="text-sm font-bold text-stone-500 text-center py-8">{t('import.importing')}</p>
            ) : (
              <label className="block border-2 border-dashed border-stone-300 rounded-xl p-8 text-center cursor-pointer hover:border-teal-400 hover:bg-teal-50/30 transition-colors">
                <Upload className="w-8 h-8 text-stone-400 mx-auto mb-2" />
                <span className="text-sm font-bold text-stone-600">{t('import.choose')}</span>
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleImport(f) }} />
              </label>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
