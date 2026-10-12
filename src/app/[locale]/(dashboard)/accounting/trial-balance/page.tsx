'use client'

import { useState, useEffect } from 'react'
import { ArrowLeft, Download, FileText, Printer } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useTranslations, useLocale } from 'next-intl'

export default function TrialBalancePage() {
  const t = useTranslations('Accounting.trial_balance')
  const ta = useTranslations('Accounting.chart')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState('2026-12-31')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)


  const fetchBalance = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tenantId, from, to })
      const res = await fetch(`/api/accounting/trial-balance?${params}`)
      setData(await res.json())
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat(`${locale}-TN`, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v) + ' DT'

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto min-h-screen bg-transparent pt-0">
      <div className="flex items-center gap-4">
        <button onClick={() => history.back()} className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all">
          <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
        </button>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-violet-500/10 rounded-2xl"><FileText className="w-6 h-6 text-violet-400" /></div>
          <div><h1 className="text-3xl font-black text-white">{t('title')}</h1><p className="text-zinc-500 text-sm font-medium">{t('subtitle')}</p></div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[1.5rem] p-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('from')}</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm font-medium focus:outline-none focus:border-teal-500" />
        </div>
        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('to')}</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm font-medium focus:outline-none focus:border-teal-500" />
        </div>
        <button onClick={fetchBalance} disabled={loading || !tenantId} className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-700 text-white rounded-xl font-bold text-sm transition-all">
          {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t('computing')}</> : t('show')}
        </button>
      </div>

      {/* Report type selector */}
      {data && (
        <div className="flex items-center gap-3 overflow-x-auto pb-2">
          <a href={`/api/accounting/reports/financial?from=${from}&to=${to}&type=bilan`} target="_blank" className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-xs whitespace-nowrap transition-all">
            <Printer className="w-3 h-3" /> {t('balance_sheet')}
          </a>
          <a href={`/api/accounting/reports/financial?from=${from}&to=${to}&type=cr`} target="_blank" className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs whitespace-nowrap transition-all">
            <Printer className="w-3 h-3" /> {t('income_statement')}
          </a>
          <a href={`/api/accounting/reports/financial?from=${from}&to=${to}&type=ebp`} target="_blank" className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-xl font-bold text-xs whitespace-nowrap transition-all">
            <Printer className="w-3 h-3" /> {t('cash_flow')}
          </a>
        </div>
      )}

      {/* Balance check */}
      {data && (
        <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl text-sm font-bold ${data.isBalanced ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {data.isBalanced
            ? t('balanced')
            : t('unbalanced', { debit: formatCurrency(data.totalDebit), credit: formatCurrency(data.totalCredit) })}
        </div>
      )}

      {/* Trial balance table */}
      {data && (
        <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[1.5rem] overflow-hidden">
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full text-start">
            <thead>
              <tr className="bg-zinc-800/50">
                <th className="px-5 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('account_no')}</th>
                <th className="px-5 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('account_name')}</th>
                <th className="px-5 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('type')}</th>
                <th className="px-5 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('debit_balances')}</th>
                <th className="px-5 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('credit_balances')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row: any, i: number) => (
                <tr key={i} className="border-t border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                  <td className="px-5 py-3 text-sm font-mono font-black text-amber-400">{row.accountNumber}</td>
                  <td className="px-5 py-3 text-sm font-medium text-white">{row.accountName}</td>
                  <td className="px-5 py-3 text-xs font-bold uppercase text-end">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] ${row.type === 'ASSET' ? 'bg-blue-500/10 text-blue-400' : row.type === 'LIABILITY' ? 'bg-red-500/10 text-red-400' : row.type === 'EXPENSE' ? 'bg-orange-500/10 text-orange-400' : 'bg-green-500/10 text-green-400'}`}>{ta.has(`types.${row.type}`) ? ta(`types.${row.type}`) : row.type}</span>
                  </td>
                  <td className="px-5 py-3 text-sm text-end font-mono text-blue-400">{row.debit > 0 ? formatCurrency(row.debit) : ''}</td>
                  <td className="px-5 py-3 text-sm text-end font-mono text-red-400">{row.credit > 0 ? formatCurrency(row.credit) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-800/50 border-t-2 border-zinc-600">
                <td colSpan={3} className="px-5 py-4 text-sm font-black text-white uppercase tracking-widest">{t('totals')}</td>
                <td className="px-5 py-4 text-end font-black text-blue-400 text-lg">{formatCurrency(data.totalDebit)}</td>
                <td className="px-5 py-4 text-end font-black text-red-400 text-lg">{formatCurrency(data.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )}

      {!data && !loading && (
        <div className="text-center py-20 text-zinc-600">
          <FileText className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="font-bold text-lg">{t('empty')}</p>
        </div>
      )}
    </div>
  )
}