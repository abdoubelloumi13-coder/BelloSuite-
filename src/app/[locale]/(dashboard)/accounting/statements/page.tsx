'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Scale, Printer, AlertTriangle, RefreshCw } from 'lucide-react'
import { apiErrorMessage } from '@/lib/zod-helpers'

interface Item { key: string; label: string; gross: number; depreciation?: number; net: number }
interface Statements {
  from: string
  to: string
  brouillonsNonValides: number
  bilan: {
    actif: { nonCourants: Item[]; totalNonCourants: number; courants: Item[]; totalCourants: number; total: number }
    passif: {
      capitauxPropres: Item[]; totalCapitauxPropres: number
      nonCourants: Item[]; totalNonCourants: number
      courants: Item[]; totalCourants: number
      totalPassifs: number; total: number
    }
    ecart: number
    equilibre: boolean
  }
  resultat: {
    produitsExploitation: Item[]; totalProduitsExploitation: number
    chargesExploitation: Item[]; totalChargesExploitation: number
    resultatExploitation: number
    financier: Item[]
    resultatActivitesOrdinairesAvantImpot: number
    impotSurBenefices: number
    resultatNet: number
  }
}

const year = new Date().getFullYear()

export default function FinancialStatementsPage() {
  const t = useTranslations('Accounting.statements')
  const locale = useLocale()
  const [from, setFrom] = useState(`${year}-01-01`)
  const [to, setTo] = useState(`${year}-12-31`)
  const [data, setData] = useState<Statements | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fmt = (v: number) =>
    new Intl.NumberFormat(`${locale}-TN`, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v || 0)
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(`${locale}-TN`)
  const label = (i: Item) => (t.has(`items.${i.key}`) ? t(`items.${i.key}`) : i.label)

  const load = useCallback(async (f: string, tt: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/accounting/reports/financial?from=${f}&to=${tt}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) { setData(null); setError(apiErrorMessage(json, t('load_error'))); return }
      setData(json)
    } catch {
      setError(t('load_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const id = setTimeout(() => { void load(`${year}-01-01`, `${year}-12-31`) }, 0)
    return () => clearTimeout(id)
  }, [load])

  const inputCls = 'bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500 print:hidden'

  const row = (i: Item, withDep?: boolean) => (
    <tr key={i.key} className="border-t border-zinc-800/30">
      <td className="px-4 py-2 text-sm text-zinc-300">{label(i)}</td>
      {withDep && <td className="px-3 py-2 text-end font-mono text-xs text-zinc-400">{fmt(i.gross)}</td>}
      {withDep && <td className="px-3 py-2 text-end font-mono text-xs text-zinc-400">{i.depreciation ? `(${fmt(i.depreciation)})` : ''}</td>}
      <td className="px-4 py-2 text-end font-mono text-sm text-white">{fmt(i.net)}</td>
    </tr>
  )
  const sub = (text: string, value: number, cols: number, strong?: boolean) => (
    <tr className={`border-t ${strong ? 'border-zinc-500 bg-zinc-800/60' : 'border-zinc-700 bg-zinc-800/30'}`}>
      <td colSpan={cols - 1} className={`px-4 py-2 text-sm ${strong ? 'font-black text-white uppercase tracking-wide' : 'font-bold text-zinc-200'}`}>{text}</td>
      <td className={`px-4 py-2 text-end font-mono ${strong ? 'font-black text-teal-300' : 'font-bold text-white'}`}>{fmt(value)}</td>
    </tr>
  )
  const head = (text: string, cols: number) => (
    <tr><td colSpan={cols} className="px-4 pt-4 pb-1 text-[10px] font-black text-zinc-500 uppercase tracking-widest">{text}</td></tr>
  )

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-7xl mx-auto print:p-0 print:text-black">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-500/10 rounded-2xl print:hidden"><Scale className="w-6 h-6 text-teal-400" /></div>
          <div>
            <h1 className="text-3xl font-black text-white">{t('title')}</h1>
            <p className="text-zinc-500 text-sm font-medium">{t('subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3 print:hidden">
          <label className="space-y-1">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('from')}</span>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('to')}</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
          </label>
          <button onClick={() => load(from, to)} disabled={loading} className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-700 text-white rounded-xl font-bold text-sm">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> {t('show')}
          </button>
          <button onClick={() => window.print()} disabled={!data} className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-sm">
            <Printer className="w-4 h-4" /> {t('print')}
          </button>
        </div>
      </div>

      {error && <div role="alert" className="px-4 py-3 rounded-2xl text-sm font-bold bg-red-500/10 text-red-400 border border-red-500/20">{error}</div>}

      {data && data.brouillonsNonValides > 0 && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-2xl text-sm font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {t('drafts_warning', { count: data.brouillonsNonValides })}
        </div>
      )}

      {data && (
        <>
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black text-white">{t('balance_sheet', { date: fmtDate(data.to) })}</h2>
              <span className={`px-3 py-1 rounded-xl text-xs font-bold ${data.bilan.equilibre ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                {data.bilan.equilibre ? t('balanced') : t('unbalanced', { diff: fmt(data.bilan.ecart) })}
              </span>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-x-auto">
                <table className="w-full min-w-[420px]">
                  <thead>
                    <tr className="bg-zinc-800/50 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                      <th className="px-4 py-3 text-start">{t('assets')}</th>
                      <th className="px-3 py-3 text-end">{t('gross')}</th>
                      <th className="px-3 py-3 text-end">{t('depreciation')}</th>
                      <th className="px-4 py-3 text-end">{t('net')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {head(t('non_current_assets'), 4)}
                    {data.bilan.actif.nonCourants.map(i => row(i, true))}
                    {sub(t('subtotal'), data.bilan.actif.totalNonCourants, 4)}
                    {head(t('current_assets'), 4)}
                    {data.bilan.actif.courants.map(i => row(i, true))}
                    {sub(t('subtotal'), data.bilan.actif.totalCourants, 4)}
                    {sub(t('total_assets'), data.bilan.actif.total, 4, true)}
                  </tbody>
                </table>
              </div>
              <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-x-auto">
                <table className="w-full min-w-[360px]">
                  <thead>
                    <tr className="bg-zinc-800/50 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                      <th className="px-4 py-3 text-start">{t('equity_liabilities')}</th>
                      <th className="px-4 py-3 text-end">{t('net')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {head(t('equity'), 2)}
                    {data.bilan.passif.capitauxPropres.map(i => row(i))}
                    {sub(t('total_equity'), data.bilan.passif.totalCapitauxPropres, 2)}
                    {head(t('non_current_liabilities'), 2)}
                    {data.bilan.passif.nonCourants.map(i => row(i))}
                    {sub(t('subtotal'), data.bilan.passif.totalNonCourants, 2)}
                    {head(t('current_liabilities'), 2)}
                    {data.bilan.passif.courants.map(i => row(i))}
                    {sub(t('subtotal'), data.bilan.passif.totalCourants, 2)}
                    {sub(t('total_liabilities'), data.bilan.passif.totalPassifs, 2)}
                    {sub(t('total_equity_liabilities'), data.bilan.passif.total, 2, true)}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-3 print:break-before-page">
            <h2 className="text-xl font-black text-white">{t('income_statement', { from: fmtDate(data.from), to: fmtDate(data.to) })}</h2>
            <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-x-auto max-w-3xl">
              <table className="w-full min-w-[360px]">
                <tbody>
                  {head(t('operating_income'), 2)}
                  {data.resultat.produitsExploitation.map(i => row(i))}
                  {sub(t('total_operating_income'), data.resultat.totalProduitsExploitation, 2)}
                  {head(t('operating_expenses'), 2)}
                  {data.resultat.chargesExploitation.map(i => row(i))}
                  {sub(t('total_operating_expenses'), data.resultat.totalChargesExploitation, 2)}
                  {sub(t('operating_result'), data.resultat.resultatExploitation, 2, true)}
                  {data.resultat.financier.map(i => row(i))}
                  {sub(t('ordinary_result'), data.resultat.resultatActivitesOrdinairesAvantImpot, 2)}
                  <tr className="border-t border-zinc-800/30">
                    <td className="px-4 py-2 text-sm text-zinc-300">{t('income_tax')}</td>
                    <td className="px-4 py-2 text-end font-mono text-sm text-white">{fmt(data.resultat.impotSurBenefices)}</td>
                  </tr>
                  {sub(t('net_result'), data.resultat.resultatNet, 2, true)}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
