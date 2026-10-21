'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Percent, RefreshCw } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { apiErrorMessage } from '@/lib/zod-helpers'
import type { VatDeclaration } from '@/lib/vat-declaration'

const currentMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function VatDeclarationPage() {
  const t = useTranslations('Accounting.vat')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [period, setPeriod] = useState(currentMonth())
  const [previousCredit, setPreviousCredit] = useState('')
  const [data, setData] = useState<VatDeclaration | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fmt = (v: number) =>
    new Intl.NumberFormat(`${locale}-TN`, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v || 0) + ' DT'

  const load = useCallback(async () => {
    if (!tenantId) return
    const [year, month] = period.split('-')
    if (!year || !month) return
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({ tenantId, month: String(Number(month)), year })
      if (Number(previousCredit) > 0) qs.set('previousCredit', String(Number(previousCredit)))
      const res = await fetch(`/api/accounting/tax-declarations/vat?${qs}`)
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.collected) {
        setData(null)
        setError(apiErrorMessage(json, t('load_error')))
      } else {
        setData(json as VatDeclaration)
      }
    } catch {
      setError(t('load_error'))
    } finally {
      setLoading(false)
    }
  }, [tenantId, period, previousCredit, t])

  useEffect(() => {
    const id = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(id)
    // rechargement automatique au changement de mois ; le crédit reporté s'applique via le bouton
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, period])

  const card = 'bg-zinc-900/40 border border-zinc-800/50 rounded-[1.5rem] p-6'
  const row = 'flex justify-between py-2 border-b border-zinc-800/40 text-sm'

  return (
    <div className="p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-teal-500/10 rounded-2xl"><Percent className="w-6 h-6 text-teal-400" /></div>
        <div>
          <h1 className="text-3xl font-black text-white">{t('title')}</h1>
          <p className="text-zinc-500 text-sm font-medium">{t('subtitle')}</p>
        </div>
      </div>

      <div className={`${card} flex flex-wrap gap-4 items-end`}>
        <label className="space-y-1">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('month')}</span>
          <input type="month" value={period} onChange={e => setPeriod(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm" />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('previous_credit')}</span>
          <input type="number" min="0" step="0.001" value={previousCredit} onChange={e => setPreviousCredit(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm w-40 text-end" />
        </label>
        <button onClick={() => void load()} disabled={loading || !tenantId} className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-700 text-white rounded-xl font-bold text-sm">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {t('compute')}
        </button>
      </div>

      {error && <div role="alert" className="px-5 py-3 rounded-2xl text-sm font-bold bg-red-500/10 text-red-400 border border-red-500/20">{error}</div>}

      {data && (
        <>
          <div className={card}>
            <h2 className="text-white font-black mb-3">{t('collected_title')}</h2>
            {data.collected.byRate.length === 0 ? (
              <p className="text-zinc-500 text-sm">{t('no_sales')}</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-widest text-zinc-500">
                    <th className="text-start py-2">{t('rate')}</th>
                    <th className="text-end py-2">{t('base')}</th>
                    <th className="text-end py-2">{t('vat_amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.collected.byRate.map(l => (
                    <tr key={l.rate} className="border-t border-zinc-800/40 text-zinc-300">
                      <td className="py-2 font-bold">{l.rate} %</td>
                      <td className="py-2 text-end font-mono">{fmt(l.base)}</td>
                      <td className="py-2 text-end font-mono">{fmt(l.vat)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-zinc-700 text-white font-black">
                    <td className="py-2">{t('total')}</td>
                    <td className="py-2 text-end font-mono">{fmt(data.collected.base)}</td>
                    <td className="py-2 text-end font-mono">{fmt(data.collected.total)}</td>
                  </tr>
                </tbody>
              </table>
            )}
            <p className="text-xs text-zinc-500 mt-3">{t('docs_count', { invoices: data.salesDocuments, credits: data.creditNotes })}</p>
          </div>

          <div className={card}>
            <div className={row}><span className="text-zinc-400">{t('collected_total')}</span><span className="font-mono text-white">{fmt(data.collected.total)}</span></div>
            <div className={row}><span className="text-zinc-400">{t('deductible', { count: data.deductible.documents })}</span><span className="font-mono text-white">− {fmt(data.deductible.total)}</span></div>
            {data.previousCredit > 0 && <div className={row}><span className="text-zinc-400">{t('previous_credit')}</span><span className="font-mono text-white">− {fmt(data.previousCredit)}</span></div>}
            <div className={`${row} font-black`}>
              <span className={data.status === 'CREDIT' ? 'text-emerald-400' : 'text-white'}>{data.status === 'CREDIT' ? t('vat_credit') : t('vat_due')}</span>
              <span className={`font-mono ${data.status === 'CREDIT' ? 'text-emerald-400' : 'text-amber-400'}`}>{fmt(data.status === 'CREDIT' ? data.vatCredit : data.vatDue)}</span>
            </div>
            <div className={row}><span className="text-zinc-400">{t('fodec')}</span><span className="font-mono text-white">{fmt(data.fodec)}</span></div>
            <div className={row}><span className="text-zinc-400">{t('stamp')}</span><span className="font-mono text-white">{fmt(data.stamp)}</span></div>
            <div className="flex justify-between pt-4 text-lg font-black">
              <span className="text-white">{t('total_to_pay')}</span>
              <span className="font-mono text-teal-400">{fmt(data.totalToPay)}</span>
            </div>
            {data.vatCredit > 0 && <p className="text-xs text-emerald-400 mt-2">{t('credit_hint', { amount: fmt(data.vatCredit) })}</p>}
          </div>
          <p className="text-xs text-zinc-500">{t('disclaimer')}</p>
        </>
      )}
    </div>
  )
}
