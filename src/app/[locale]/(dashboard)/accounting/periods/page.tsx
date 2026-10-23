'use client'

import { useState, useEffect, useCallback } from 'react'
import { Calendar, Plus, Save, AlertTriangle, CheckCircle2, Lock, Unlock, X } from 'lucide-react'
import { apiErrorMessage } from '@/lib/zod-helpers'
import { useSession } from '@/hooks/useSession'
import { useTranslations, useLocale } from 'next-intl'

interface Period {
  id: string
  name: string
  startDate: string
  endDate: string
  isClosed: boolean
}

interface ClosingPreview {
  period: Period
  canClose: boolean
  blockers: string[]
  resultatNet: number
  closingLines: unknown[]
}

export default function PeriodsPage() {
  const t = useTranslations('Accounting.periods')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)

  const currentYear = new Date().getFullYear()
  const [formData, setFormData] = useState({
    name: t('default_name', { year: currentYear }),
    startDate: `${currentYear}-01-01`,
    endDate: `${currentYear}-12-31`
  })
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [preview, setPreview] = useState<ClosingPreview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const [confirmReopen, setConfirmReopen] = useState<string | null>(null)

  const fmt = (v: number) =>
    new Intl.NumberFormat(`${locale}-TN`, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v || 0)

  const openClose = async (period: Period) => {
    setActionError('')
    setBusy(period.id)
    try {
      const res = await fetch(`/api/accounting/periods/${period.id}/close`)
      const json = await res.json().catch(() => null)
      if (!res.ok) { setActionError(apiErrorMessage(json, t('action_error'))); return }
      setPreview(json)
    } catch {
      setActionError(t('action_error'))
    } finally {
      setBusy(null)
    }
  }

  const confirmClose = async () => {
    if (!preview) return
    setBusy(preview.period.id)
    setActionError('')
    try {
      const res = await fetch(`/api/accounting/periods/${preview.period.id}/close`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setActionError(apiErrorMessage(json, t('action_error'))); return }
      setPreview(null)
      fetchPeriods(tenantId)
    } catch {
      setActionError(t('action_error'))
    } finally {
      setBusy(null)
    }
  }

  const reopen = async (period: Period) => {
    setConfirmReopen(null)
    setBusy(period.id)
    setActionError('')
    try {
      const res = await fetch(`/api/accounting/periods/${period.id}/reopen`, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setActionError(apiErrorMessage(json, t('action_error'))); return }
      fetchPeriods(tenantId)
    } catch {
      setActionError(t('action_error'))
    } finally {
      setBusy(null)
    }
  }

  const fetchPeriods = useCallback(async (tid: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/accounting/periods`)
      const data = await res.json()
      if (Array.isArray(data)) setPeriods(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const tid = tenantId
    fetchPeriods(tid)
  }, [fetchPeriods])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/accounting/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, tenantId })
      })
      if (res.ok) {
        const nextYear = parseInt(formData.name.replace(/[^0-9]/g, '')) + 1 || currentYear + 1
        setFormData({ 
          name: t('default_name', { year: nextYear }), 
          startDate: `${nextYear}-01-01`, 
          endDate: `${nextYear}-12-31` 
        })
        fetchPeriods(tenantId)
      } else {
        const json = await res.json().catch(() => null)
        setActionError(apiErrorMessage(json, t('create_error')))
      }
    } catch (err) {
      console.error(err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-black text-white tracking-tighter">{t('title')}</h1>
        <p className="text-zinc-400 mt-2 text-sm">{t('subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* CREATE FORM */}
        <div className="bg-zinc-900 border border-zinc-800/50 rounded-3xl p-6 h-fit">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-500">
              <Plus className="w-5 h-5" />
            </div>
            <h2 className="text-lg font-bold text-white">{t('new')}</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t('name')}</label>
              <input 
                type="text" 
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:border-teal-500 transition-all font-mono" 
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t('start')}</label>
              <input 
                type="date" 
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:border-teal-500 transition-all" 
                value={formData.startDate}
                onChange={e => setFormData({...formData, startDate: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">{t('end')}</label>
              <input 
                type="date" 
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:border-teal-500 transition-all" 
                value={formData.endDate}
                onChange={e => setFormData({...formData, endDate: e.target.value})}
              />
            </div>
            
            <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex gap-3 mt-4">
               <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
               <p className="text-xs text-amber-500/90 leading-relaxed">
                 {t('hint')}
               </p>
            </div>

            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full mt-4 flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white font-bold py-3 rounded-xl transition-all"
            >
              {isSubmitting ? <span className="animate-spin w-4 h-4 border-2 border-white/30 border-t-white rounded-full"></span> : <Save className="w-4 h-4" />}
              {t('open_year')}
            </button>
          </form>
        </div>

        {/* LIST */}
        {actionError && (
          <div role="alert" className="lg:col-span-3 order-first flex items-start gap-2 px-4 py-3 rounded-2xl text-sm font-bold bg-red-500/10 text-red-400 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {actionError}
          </div>
        )}
        <div className="lg:col-span-2 bg-zinc-900 border border-zinc-800/50 rounded-3xl p-6">
          <h2 className="text-lg font-bold text-white mb-6">{t('existing')}</h2>
          
          {loading ? (
            <div className="flex justify-center py-10"><span className="animate-spin w-6 h-6 border-2 border-teal-500/30 border-t-teal-500 rounded-full"></span></div>
          ) : periods.length === 0 ? (
            <div className="text-center py-12">
              <Calendar className="w-12 h-12 text-zinc-700 mx-auto mb-4" />
              <h3 className="text-white font-medium">{t('empty_title')}</h3>
              <p className="text-zinc-500 text-sm mt-1">{t('empty_desc')}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {periods.map(period => {
                const startDate = new Date(period.startDate).toLocaleDateString(`${locale}-TN`)
                const endDate = new Date(period.endDate).toLocaleDateString(`${locale}-TN`)
                
                return (
                  <div key={period.id} className={`group flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-2xl transition-all ${!period.isClosed ? 'hover:border-teal-500/30' : 'opacity-80'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl border flex items-center justify-center ${period.isClosed ? 'bg-zinc-900 border-zinc-800 text-zinc-500' : 'bg-teal-500/10 border-teal-500/20 text-teal-500'}`}>
                        {period.isClosed ? <Lock className="w-5 h-5" /> : <Calendar className="w-5 h-5" />}
                      </div>
                      <div>
                        <h3 className="text-white font-bold">{period.name}</h3>
                        <p className="text-xs text-zinc-500 mt-1">{t('range', { start: startDate, end: endDate })}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {period.isClosed ? (
                         <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-zinc-800 text-zinc-400 border border-zinc-700 flex items-center gap-1.5">
                           {t('closed')}
                         </span>
                      ) : (
                        <span className="px-2.5 py-1 text-[10px] font-black uppercase tracking-widest rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3" /> {t('open')}
                        </span>
                      )}
                      {period.isClosed && confirmReopen === period.id ? (
                        <span className="flex items-center gap-2">
                          <span className="text-xs text-amber-300 max-w-[220px]">{t('reopen_confirm', { name: period.name })}</span>
                          <button onClick={() => reopen(period)} disabled={busy === period.id} className="px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50">{t('reopen')}</button>
                          <button onClick={() => setConfirmReopen(null)} className="p-1 text-zinc-500 hover:text-white" aria-label={t('cancel')}><X className="w-4 h-4" /></button>
                        </span>
                      ) : period.isClosed ? (
                        <button onClick={() => setConfirmReopen(period.id)} disabled={busy === period.id} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50">
                          <Unlock className="w-3 h-3" /> {t('reopen')}
                        </button>
                      ) : (
                        <button onClick={() => openClose(period)} disabled={busy === period.id} className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50">
                          <Lock className="w-3 h-3" /> {busy === period.id ? t('loading') : t('close')}
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-3xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-bold text-white">{t('close_title', { name: preview.period.name })}</h2>
              <button onClick={() => setPreview(null)} className="text-zinc-500 hover:text-white" aria-label={t('cancel')}><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-zinc-400 leading-relaxed">{t('close_explain')}</p>
            <div className={`px-4 py-3 rounded-2xl text-sm font-bold ${preview.resultatNet >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {preview.resultatNet >= 0
                ? t('result_profit', { amount: fmt(preview.resultatNet) })
                : t('result_loss', { amount: fmt(Math.abs(preview.resultatNet)) })}
              <span className="block text-xs font-medium opacity-80 mt-1">{t('closing_lines', { count: Math.max(preview.closingLines.length - 1, 0) })}</span>
            </div>
            {!preview.canClose && (
              <div className="px-4 py-3 rounded-2xl text-sm bg-amber-500/10 text-amber-400 border border-amber-500/20 space-y-1">
                <p className="font-bold">{t('blockers_title')}</p>
                <ul className="list-disc ps-5">{preview.blockers.map(b => <li key={b}>{b}</li>)}</ul>
              </div>
            )}
            {actionError && <p role="alert" className="text-sm font-bold text-red-400">{actionError}</p>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setPreview(null)} className="px-4 py-2 rounded-xl text-sm font-bold bg-zinc-800 text-zinc-300 hover:bg-zinc-700">{t('cancel')}</button>
              <button onClick={confirmClose} disabled={!preview.canClose || busy === preview.period.id} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-white">
                <Lock className="w-4 h-4" /> {t('confirm_close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
