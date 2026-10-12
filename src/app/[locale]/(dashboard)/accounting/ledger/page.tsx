'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen, ChevronDown, ChevronRight, Download, FileText,
  Filter, ArrowLeft, Printer, Calendar
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useTranslations, useLocale } from 'next-intl'

export default function LedgerPage() {
  const t = useTranslations('Accounting.ledger')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [periodId, setPeriodId] = useState('')
  const [from, setFrom] = useState('2026-01-01')
  const [to, setTo] = useState('2026-12-31')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())
  const [periods, setPeriods] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/accounting/periods')
      .then(r => r.json())
      .then(data => setPeriods(Array.isArray(data) ? data : []))
      .catch(() => setPeriods([]))
  }, [])

  const fetchLedger = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ tenantId, from, to })
      if (periodId) params.set('periodId', periodId)
      const res = await fetch(`/api/accounting/ledger?${params}`)
      const json = await res.json()
      setData(json)
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  const toggleAccount = (id: string) => {
    const next = new Set(expandedAccounts)
    next.has(id) ? next.delete(id) : next.add(id)
    setExpandedAccounts(next)
  }

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat(`${locale}-TN`, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v) + ' DT'

  const totalDebit = data?.accounts?.reduce((s: number, a: any) => s + a.closingDebit, 0) || 0
  const totalCredit = data?.accounts?.reduce((s: number, a: any) => s + a.closingCredit, 0) || 0

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto min-h-screen bg-transparent pt-0">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => history.back()} className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-400 hover:text-white transition-all">
          <ArrowLeft className="w-5 h-5 rtl:rotate-180" />
        </button>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 rounded-2xl"><BookOpen className="w-6 h-6 text-emerald-400" /></div>
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
        <div>
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-2">{t('period')}</label>
          <select value={periodId} onChange={e => setPeriodId(e.target.value)} className="bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-2.5 text-white text-sm font-medium focus:outline-none focus:border-teal-500 min-w-[180px]">
            <option value="">{t('all_periods')}</option>
            {periods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={fetchLedger} disabled={loading || !tenantId} className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-700 text-white rounded-xl font-bold text-sm transition-all">
          {loading ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> {t('loading')}</> : <><Filter className="w-4 h-4" /> {t('show')}</>}
        </button>
      </div>

      {/* Balance check */}
      {data && (
        <div className={`flex items-center gap-3 px-5 py-3 rounded-2xl text-sm font-bold ${data.isBalanced ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {data.isBalanced ? t('balanced') : t('unbalanced', { debit: formatCurrency(totalDebit), credit: formatCurrency(totalCredit) })}
        </div>
      )}

      {/* Ledger table */}
      {data && (
        <div className="space-y-4">
          {data.accounts.map((accountEntry: any) => {
            const { account, movements, closingDebit, closingCredit, balance, balanceType } = accountEntry
            const isExpanded = expandedAccounts.has(account.id)
            const hasMovement = movements.length > 0

            return (
              <div key={account.id} className="bg-zinc-900/40 border border-zinc-800/50 rounded-[1.5rem] overflow-hidden">
                {/* Account header */}
                <button onClick={() => toggleAccount(account.id)} className="w-full flex items-center gap-4 p-5 hover:bg-zinc-800/30 transition-all text-start">
                  <div className="text-zinc-600">{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="font-black text-amber-400 font-mono text-sm">{account.accountNumber}</span>
                      <span className="text-white font-bold text-sm">{account.name}</span>
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${account.type === 'ASSET' ? 'bg-blue-500/10 text-blue-400' : account.type === 'LIABILITY' ? 'bg-red-500/10 text-red-400' : account.type === 'EXPENSE' ? 'bg-orange-500/10 text-orange-400' : 'bg-green-500/10 text-green-400'}`}>{account.type}</span>
                    </div>
                  </div>
                  {!hasMovement && <span className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest">{t('no_entry')}</span>}
                  {hasMovement && (
                    <div className="flex items-center gap-6 shrink-0">
                      <div className="text-end"><span className="text-[10px] text-zinc-500 font-bold block">{t('debits')}</span><span className="text-sm font-black text-white">{formatCurrency(closingDebit)}</span></div>
                      <div className="text-end"><span className="text-[10px] text-zinc-500 font-bold block">{t('credits')}</span><span className="text-sm font-black text-white">{formatCurrency(closingCredit)}</span></div>
                      <div className="text-end min-w-[120px]"><span className="text-[10px] text-zinc-500 font-bold block">{t('balance')}</span><span className={`text-sm font-black ${balanceType === 'DEBIT' ? 'text-blue-400' : 'text-red-400'}`}>{formatCurrency(Math.abs(balance))} {balanceType === 'DEBIT' ? t('balance_d') : t('balance_c')}</span></div>
                    </div>
                  )}
                </button>

                {/* Movement lines */}
                {isExpanded && hasMovement && (
                  <div className="border-t border-zinc-800/50">
                    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                      <table className="w-full text-start">
                      <thead>
                        <tr className="bg-zinc-800/30">
                          <th className="px-5 py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('date')}</th>
                          <th className="px-3 py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('voucher')}</th>
                          <th className="px-3 py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('label')}</th>
                          <th className="px-3 py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('debit')}</th>
                          <th className="px-5 py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('credit')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movements.map((m: any, i: number) => (
                          <tr key={i} className="border-t border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                            <td className="px-5 py-2.5 text-xs text-zinc-400 font-mono">{new Date(m.date).toLocaleDateString(`${locale}-TN`)}</td>
                            <td className="px-3 py-2.5 text-xs text-zinc-500 font-mono">{m.entryNumber}</td>
                            <td className="px-3 py-2.5 text-xs text-zinc-300 max-w-[300px] truncate">{m.description}</td>
                            <td className="px-3 py-2.5 text-xs text-zinc-300 text-end font-mono">{m.debit > 0 ? formatCurrency(m.debit) : ''}</td>
                            <td className="px-5 py-2.5 text-xs text-zinc-300 text-end font-mono">{m.credit > 0 ? formatCurrency(m.credit) : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Empty state */}
      {!data && !loading && (
        <div className="text-center py-20 text-zinc-600">
          <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-30" />
          <p className="font-bold text-lg">{t('empty_title')}</p>
          <p className="text-sm mt-1">{t('empty_desc')}</p>
        </div>
      )}
    </div>
  )
}