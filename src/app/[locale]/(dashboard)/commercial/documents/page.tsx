'use client'

import { useState, useEffect } from 'react'
import { Search, FileText, Calendar, User, Download, ExternalLink, Printer, FileCode, Plus } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { useTranslations, useLocale } from 'next-intl'
import { generateTEIFXml as generateTEIF } from '@/lib/teif-generator'
import { useSession } from '@/hooks/useSession'

export default function InvoicesPage() {
  const t = useTranslations('Commercial.Invoices')
  const dt = useTranslations('Commercial.DocumentTypes')
  const locale = useLocale()
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const { tenantId } = useSession()

  useEffect(() => {
    fetchInvoices(tenantId)
  }, [])

  const fetchInvoices = async (tid: string) => {
    try {
      const res = await fetch(`/api/commercial/invoices`)
      const data = await res.json()
      setInvoices(data)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const exportTEIF = (inv: any) => {
    let xml: string
    try {
    xml = generateTEIF({
      invoiceNumber: inv.number,
      type: inv.type,
      issueDate: new Date(inv.date).toISOString().split('T')[0],
      tenant: {
        name: inv.tenant.name,
        matriculeFiscal: inv.tenant.matriculeFiscal || '',
        address: inv.tenant.address || '',
        city: inv.tenant.city || '',
        zipCode: inv.tenant.zipCode || '',
      },
      client: {
        name: inv.client.name,
        matriculeFiscal: inv.client.matriculeFiscal || '',
        address: inv.client.address || '',
        city: inv.client.city || '',
      },
      items: inv.items ?? [],
      totals: {
        subtotalHT: Number(inv.subtotalHT),
        totalFodec: Number(inv.totalFodec),
        totalVAT: Number(inv.totalVAT),
        timbreFiscal: Number(inv.timbreFiscal),
        totalTTC: Number(inv.totalTTC),
        vatSummary: inv.vatSummary as any,
      }
    })
    } catch (e: any) {
      alert(e?.errors ? e.errors.join('\n') : (e?.message || 'TEIF'))
      return
    }

    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${inv.number}_TEIF.xml`
    a.click()
  }

  const filteredInvoices = Array.isArray(invoices) ? invoices.filter(inv => 
    inv.number.toLowerCase().includes(searchTerm.toLowerCase()) || 
    inv.client?.name.toLowerCase().includes(searchTerm.toLowerCase())
  ) : []

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto min-h-screen bg-transparent pt-0 text-start">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
           <h1 className="text-4xl font-black text-stone-900 dark:text-white tracking-tighter flex items-center gap-3">
              {t('title')}
           </h1>
           <p className="text-zinc-500 mt-2 font-medium uppercase tracking-widest text-[10px] font-bold">{t('subtitle')}</p>
        </div>
        <Link 
          href="/commercial/documents/new"
          className="flex items-center gap-2 px-6 py-4 bg-teal-600 hover:bg-teal-500 text-white rounded-2xl transition-all shadow-lg shadow-teal-600/20 font-black uppercase tracking-widest text-xs"
        >
          <Plus className="w-5 h-5" /> {t('new_invoice')}
        </Link>
      </div>

      {/* Search Bar */}
      <div className="relative group max-w-md">
        <Search className="w-5 h-5 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-teal-400 transition-colors" />
        <input 
          placeholder={t('search_placeholder')}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full bg-white dark:bg-zinc-900/40 backdrop-blur-xl border border-stone-200 dark:border-zinc-800 focus:border-teal-500/50 rounded-2xl ps-12 pe-4 py-4 text-stone-900 dark:text-white outline-none transition-all shadow-sm text-start"
        />
      </div>

      {/* Invoices List */}
      <div className="bg-white dark:bg-zinc-900/40 backdrop-blur-xl border border-stone-200 dark:border-zinc-800/50 rounded-[2.5rem] overflow-hidden shadow-2xl shadow-teal-500/5">
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="border-b border-stone-200 dark:border-zinc-800/50 bg-stone-50 dark:bg-zinc-800/20">
                <th className="px-8 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-start">{t('table.invoice')}</th>
                <th className="px-6 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-start">{t('table.client')}</th>
                <th className="px-6 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-start">{t('table.date_due')}</th>
                <th className="px-6 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('table.total_ttc')}</th>
                <th className="px-6 py-6 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-start">{t('table.status')}</th>
                <th className="px-8 py-6 text-end text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/30 text-start">
              {loading ? (
                <tr><td colSpan={6} className="px-8 py-20 text-center text-zinc-500 font-bold uppercase tracking-widest text-xs">{t('loading')}</td></tr>
              ) : filteredInvoices.length === 0 ? (
                <tr><td colSpan={6} className="px-8 py-20 text-center text-zinc-500 font-bold uppercase tracking-widest text-xs">{t('no_invoices')}</td></tr>
              ) : filteredInvoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-stone-50 dark:hover:bg-zinc-800/30 transition-all group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                       <div className="w-12 h-12 rounded-2xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center border border-stone-200 dark:border-zinc-700/50 group-hover:border-teal-500/30 transition-all">
                          <FileText className="w-6 h-6 text-zinc-500 group-hover:text-teal-400" />
                       </div>
                       <div>
                          <p className="font-bold text-stone-900 dark:text-white tracking-tight text-base font-mono uppercase">{inv.number}</p>
                          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{t('sale_ht')}: {Number(inv.subtotalHT).toFixed(3)} {t('currency') || 'TND'}</p>
                       </div>
                    </div>
                  </td>
                  <td className="px-6 py-6">
                    <div className="flex items-center gap-2">
                       <User className="w-4 h-4 text-zinc-500" />
                       <span className="text-stone-700 dark:text-zinc-300 text-sm font-medium">{inv.client?.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-6">
                    <div className="space-y-1">
                       <div className="flex items-center gap-2 text-stone-500 dark:text-zinc-400 text-xs font-bold">
                          <Calendar className="w-3 h-3 text-zinc-400 dark:text-zinc-600" />
                          {new Date(inv.date).toLocaleDateString(locale === 'ar' ? 'ar-TN' : 'fr-TN')}
                       </div>
                       {inv.dueDate && (
                          <div className="text-[10px] font-black text-amber-600 dark:text-amber-500 uppercase tracking-tighter">{t('due_prefix')} {new Date(inv.dueDate).toLocaleDateString(locale === 'ar' ? 'ar-TN' : 'fr-TN')}</div>
                       )}
                    </div>
                  </td>
                  <td className="px-6 py-6 text-end">
                     <p className="text-sm font-black text-stone-900 dark:text-white tracking-wider">{Number(inv.totalTTC).toFixed(3)} {t('currency') || 'TND'}</p>
                     <p className="text-[9px] text-zinc-500 font-bold">{t('vat_incl')} {Number(inv.totalVAT).toFixed(3)} {t('currency') || 'TND'}</p>
                  </td>
                  <td className="px-6 py-6">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                      inv.status === 'PAID' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-500 border border-emerald-500/20' :
                      inv.status === 'DRAFT' ? 'bg-stone-100 dark:bg-zinc-800/80 text-zinc-500 border border-stone-200 dark:border-zinc-700' :
                      'bg-amber-500/10 text-amber-600 dark:text-amber-500 border border-amber-500/20'
                    }`}>
                      {dt(`STATUS.${inv.status}`) || inv.status}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-end">
                    <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-all">
                      <button 
                        onClick={() => exportTEIF(inv)}
                        className="p-3 bg-stone-100 dark:bg-zinc-800 hover:bg-emerald-500/20 text-zinc-500 dark:text-zinc-400 hover:text-emerald-500 dark:hover:text-emerald-400 rounded-xl transition-all border border-transparent hover:border-emerald-500/20"
                        title={t('export_ttn')}
                      >
                         <FileCode className="w-4 h-4" />
                      </button>
                      <button className="p-3 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white rounded-xl transition-all border border-transparent hover:border-stone-200 dark:hover:border-zinc-600"><Download className="w-4 h-4" /></button>
                      <button className="p-3 bg-stone-100 dark:bg-zinc-800 hover:bg-stone-200 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white rounded-xl transition-all border border-transparent hover:border-stone-200 dark:hover:border-zinc-600"><Printer className="w-4 h-4" /></button>
                      <Link href={`/commercial/invoices/${inv.id}`} className="p-3 bg-stone-100 dark:bg-zinc-800 hover:bg-teal-500/20 text-zinc-500 dark:text-zinc-400 hover:text-teal-600 dark:hover:text-teal-400 rounded-xl transition-all border border-transparent hover:border-teal-500/20">
                        <ExternalLink className={`w-4 h-4 ${locale === 'ar' ? 'rotate-180' : ''}`} />
                      </Link>
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
