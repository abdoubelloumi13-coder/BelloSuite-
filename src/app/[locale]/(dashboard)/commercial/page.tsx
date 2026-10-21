'use client'

import { useState, useEffect } from 'react'
import { Link } from '@/i18n/routing'
import { useTranslations, useLocale } from 'next-intl'
import {
  Users, Truck, Package, FileText,
  TrendingUp, Clock, CheckCircle, AlertTriangle,
  ArrowRight, Plus, CreditCard, Receipt,
  ArrowUpRight, ArrowDownRight, RefreshCw, ScanLine
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'

function StatCard({ 
  label, value, sub, icon: Icon, color, trend 
}: { 
  label: string; value: string; sub: string; icon: any; color: string; trend?: number 
}) {
  const colors: Record<string, string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/30',
    amber:   'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/30',
    teal:    'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/20 border-teal-100 dark:border-teal-900/30',
    red:     'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/30',
    blue:    'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 border-blue-100 dark:border-blue-900/30',
  }

  return (
    <div className={`group rounded-[2rem] border p-6 transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-zinc-200/50 dark:hover:shadow-none bg-white dark:bg-zinc-900 ${colors[color] || colors.teal} border-zinc-100 dark:border-zinc-800`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-2xl ${colors[color]?.split(' ')[2]} ${colors[color]?.split(' ')[0]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && (
          <div className={`flex items-center gap-1 text-[10px] font-black uppercase px-2 py-1 rounded-lg ${trend >= 0 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
            {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(trend)}%
          </div>
        )}
      </div>
      <div>
        <span className="text-[10px] font-black text-zinc-400 dark:text-zinc-500 uppercase tracking-widest block mb-1">
          {label}
        </span>
        <p className="text-2xl font-black text-zinc-900 dark:text-white tracking-tighter font-mono tabular-nums">
          {value}
        </p>
        <p className="text-[10px] font-bold mt-1 text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
          {sub}
        </p>
      </div>
    </div>
  )
}

export default function CommercialDashboard() {
  const t = useTranslations('Commercial')
  const locale = useLocale()
  const isRTL = locale === 'ar'
  
  const { tenantId } = useSession()
  const [stats, setStats] = useState({ totalHT: 0, totalTTC: 0, paidTTC: 0, unpaidTTC: 0, overdueTTC: 0, count: 0 })
  const [recentDocs, setRecentDocs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState({ month: new Date().getMonth() + 1, year: new Date().getFullYear() })

  const DOC_TYPES = [
    { key: 'estimate', label: t('doc_types.estimate'), icon: FileText, href: '/commercial/documents/estimates', color: 'emerald', desc: t('doc_types.estimate_desc') },
    { key: 'order', label: t('doc_types.order'), icon: Receipt, href: '/commercial/documents/client-orders', color: 'blue', desc: t('doc_types.order_desc') },
    { key: 'delivery_note', label: t('doc_types.delivery_note'), icon: Truck, href: '/commercial/documents/delivery-notes', color: 'purple', desc: t('doc_types.delivery_note_desc') },
    { key: 'invoice', label: t('doc_types.invoice'), icon: FileText, href: '/commercial/documents', color: 'teal', desc: t('doc_types.invoice_desc') },
    { key: 'supplier_order', label: t('doc_types.supplier_order'), icon: Package, href: '/commercial/documents/supplier-orders', color: 'amber', desc: t('doc_types.supplier_order_desc') },
    { key: 'supplier_receipt', label: t('doc_types.supplier_receipt'), icon: Truck, href: '/commercial/documents/supplier-receipts', color: 'teal', desc: t('doc_types.supplier_receipt_desc') },
    { key: 'scan', label: t('doc_types.scan'), icon: ScanLine, href: '/commercial/scan', color: 'teal', desc: t('doc_types.scan_desc') },
  ]

  useEffect(() => {
    fetchData(tenantId)
  }, [])

  const fetchData = async (tid: string) => {
    setLoading(true)
    try {
      const [invRes, estRes] = await Promise.all([
        fetch(`/api/commercial/invoices`),
        fetch(`/api/commercial/documents?type=QUOTE`),
      ])
      const invoices = invRes.ok ? await invRes.json() : []
      const estimates = estRes.ok ? await estRes.json() : []
      const all = [...invoices, ...estimates]

      const now = new Date()
      const paid = all.filter(d => d.status === 'PAID')
      const unpaid = all.filter(d => d.status === 'PENDING' || d.status === 'CONFIRMED' || d.status === 'SENT')
      const overdue = unpaid.filter(d => d.dueDate && new Date(d.dueDate) < now)

      setStats({
        totalHT: all.reduce((s, d) => s + Number(d.subtotalHT || 0), 0),
        totalTTC: all.reduce((s, d) => s + Number(d.totalTTC || 0), 0),
        paidTTC: paid.reduce((s, d) => s + Number(d.totalTTC || 0), 0),
        unpaidTTC: unpaid.reduce((s, d) => s + Number(d.totalTTC || 0), 0),
        overdueTTC: overdue.reduce((s, d) => s + Number(d.totalTTC || 0), 0),
        count: all.length,
      })
      setRecentDocs(all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-TN' : 'fr-TN', { 
    style: 'currency', 
    currency: 'TND', 
    maximumFractionDigits: 3 
  })

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-8 max-w-[1600px] mx-auto transition-all duration-500" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-zinc-900 p-8 rounded-[2.5rem] border border-zinc-100 dark:border-zinc-800 shadow-sm relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/5 rounded-full -mr-32 -mt-32 transition-transform group-hover:scale-110" />
        <div className="relative z-10">
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-black text-zinc-900 dark:text-white tracking-tighter">
            {t('module_title')}
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 font-medium mt-2 max-w-xl text-sm md:text-base">
            {t('module_description')}
          </p>
        </div>
        <div className="flex items-center gap-3 relative z-10 self-start md:self-center">
          <div className="relative">
            <select
              className="appearance-none px-6 py-3.5 border-2 border-zinc-100 dark:border-zinc-800 rounded-2xl text-sm font-black text-zinc-900 dark:text-white bg-zinc-50 dark:bg-zinc-950 focus:border-teal-500/50 outline-none transition-all cursor-pointer pe-12"
              value={period.month}
              onChange={e => { setPeriod(p => ({ ...p, month: +e.target.value })); fetchData(tenantId) }}
            >
              {[1,2,3,4,5,6,7,8,9,10,11,12].map((m) => (
                <option key={m} value={m}>{t(`months.${m}`)} {period.year}</option>
              ))}
            </select>
            <div className={`absolute inset-y-0 ${isRTL ? 'left-4' : 'right-4'} flex items-center pointer-events-none`}>
               <Clock className="w-4 h-4 text-zinc-400" />
            </div>
          </div>
          <button 
            onClick={() => fetchData(tenantId)}
            className="p-3.5 bg-zinc-900 dark:bg-teal-600 text-white rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-lg shadow-zinc-900/10 dark:shadow-teal-600/20"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Stats Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label={t('ca_ht')} value={fmt(stats.totalHT)} sub={t('ca_ht_desc')} icon={TrendingUp} color="teal" trend={12} />
        <StatCard label={t('total_ttc')} value={fmt(stats.totalTTC)} sub={t('total_ttc_desc')} icon={CreditCard} color="blue" />
        <StatCard label={t('paid')} value={fmt(stats.paidTTC)} sub={t('paid_desc')} icon={CheckCircle} color="emerald" trend={8} />
        <StatCard label={t('pending')} value={fmt(stats.unpaidTTC)} sub={t('pending_desc')} icon={Clock} color="amber" />
        <StatCard label={t('overdue')} value={fmt(stats.overdueTTC)} sub={t('overdue_desc')} icon={AlertTriangle} color="red" trend={-5} />
      </div>

      {/* Quick Actions / Link Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {DOC_TYPES.map(({ key, label, icon: Icon, href, color, desc }) => {
          const accents: Record<string, string> = { 
            emerald: 'group-hover:text-emerald-500 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600', 
            blue: 'group-hover:text-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600', 
            purple: 'group-hover:text-purple-500 bg-purple-50 dark:bg-purple-500/10 text-purple-600', 
            teal: 'group-hover:text-teal-500 bg-teal-50 dark:bg-teal-500/10 text-teal-600', 
            amber: 'group-hover:text-amber-500 bg-amber-50 dark:bg-amber-500/10 text-amber-600' 
          }
          return (
            <Link key={key} href={href}
              className="group bg-white dark:bg-zinc-900 p-6 rounded-[2.5rem] border border-zinc-100 dark:border-zinc-800 hover:border-teal-500/30 dark:hover:border-teal-500/20 transition-all duration-300 hover:shadow-2xl hover:shadow-teal-500/10 relative overflow-hidden text-start">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-transform group-hover:scale-110 group-hover:-rotate-3 ${accents[color]}`}>
                <Icon className="w-6 h-6" />
              </div>
              <div className="relative z-10">
                <p className="font-black text-zinc-900 dark:text-white text-base tracking-tight mb-1">{label}</p>
                <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-bold uppercase tracking-widest">{desc}</p>
              </div>
              <div className={`absolute bottom-6 ${isRTL ? 'left-6' : 'right-6'} opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0`}>
                <ArrowRight className={`w-4 h-4 text-teal-500 ${isRTL ? 'rotate-180' : ''}`} />
              </div>
            </Link>
          )
        })}
      </div>

      {/* Recent Activity Section */}
      <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] border border-zinc-100 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col">
        <div className="px-8 py-6 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-black text-zinc-900 dark:text-white text-start">{t('recent_docs')}</h2>
            <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest mt-1">{t('recent_docs_subtitle')}</p>
          </div>
          <Link href="/commercial/documents" className="group/link text-xs font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest border-b-2 border-transparent hover:border-teal-500 transition-all pb-1 flex items-center gap-2">
            {t('view_all')} <ArrowRight className={`w-4 h-4 transition-transform group-hover/link:translate-x-1 ${isRTL ? 'rotate-180 group-hover/link:-translate-x-1' : ''}`} />
          </Link>
        </div>
        
        {loading ? (
          <div className="p-24 flex flex-col items-center gap-4">
             <div className="w-12 h-12 border-4 border-teal-500/20 border-t-teal-500 rounded-full animate-spin" />
             <span className="text-zinc-400 font-bold animate-pulse">{t('loading')}...</span>
          </div>
        ) : recentDocs.length === 0 ? (
          <div className="p-24 flex flex-col items-center text-center">
            <p className="text-zinc-400 dark:text-zinc-500 font-black text-lg uppercase tracking-widest">{t('no_doc')}</p>
            <Link href="/commercial/documents/new" className="mt-4 px-6 py-3 bg-teal-600 text-white rounded-2xl font-black text-sm transition-transform active:scale-95 shadow-lg shadow-teal-500/20">
              {t('create_invoice')}
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full text-start">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800/10 text-[10px] font-black text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
                  <th className="px-8 py-5 text-start">{t('ref')}</th>
                  <th className="px-8 py-5 text-start">{t('client')}</th>
                  <th className="px-8 py-5 text-start">{t('date')}</th>
                  <th className="px-8 py-5 text-start">{t('due_date')}</th>
                  <th className="px-8 py-5 text-end">{t('amount_ttc')}</th>
                  <th className="px-8 py-5 text-start">{t('status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/30">
                {recentDocs.map(doc => (
                  <tr key={doc.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-all group">
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:text-teal-500 transition-colors">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="font-black text-zinc-900 dark:text-white text-sm font-mono tracking-tighter">{doc.number}</p>
                          <p className="text-[10px] text-zinc-400 dark:text-zinc-500 font-black uppercase tracking-widest">{doc.type}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-8 py-5">
                      <p className="text-sm font-black text-zinc-700 dark:text-zinc-300 tracking-tight">{doc.client?.name || doc.clientName || '—'}</p>
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-sm font-bold text-zinc-500 dark:text-zinc-400">
                        {new Date(doc.date).toLocaleDateString(locale === 'ar' ? 'ar-TN' : 'fr-TN')}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <span className="text-sm font-bold text-zinc-500 dark:text-zinc-400">
                        {doc.dueDate ? new Date(doc.dueDate).toLocaleDateString(locale === 'ar' ? 'ar-TN' : 'fr-TN') : '—'}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-end">
                      <p className="text-base font-black text-zinc-900 dark:text-white font-mono tracking-tighter tabular-nums">
                        {fmt(Number(doc.totalTTC))}
                      </p>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`inline-flex px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-sm ${
                        doc.status === 'PAID' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-900/30' :
                        doc.status === 'DRAFT' ? 'bg-zinc-100 text-zinc-500 border border-zinc-200 dark:bg-zinc-800/50 dark:text-zinc-400 dark:border-zinc-700' :
                        doc.status === 'CANCELLED' ? 'bg-red-50 text-red-700 border border-red-100 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900/30' :
                        'bg-amber-50 text-amber-700 border border-amber-100 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900/30'
                      }`}>
                        {t.has(`DocumentTypes.STATUS.${doc.status}`) ? t(`DocumentTypes.STATUS.${doc.status}`) : doc.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      <style jsx global>{`
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  )
}