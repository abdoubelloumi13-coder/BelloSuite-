'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowLeft, FileText, User, Calendar, Printer, Download,
  ExternalLink, Send, CheckCircle, XCircle, Clock, AlertTriangle,
  RefreshCw, QrCode, Zap, FileCode, Receipt, DollarSign
} from 'lucide-react'
import { generateTEIFXml } from '@/lib/teif-generator'
import { useSession } from '@/hooks/useSession'
import { EInvoicePanel } from '@/components/commercial/EInvoicePanel'

const TTN_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-stone-100 dark:bg-zinc-800 text-stone-500 dark:text-zinc-400',
  SUBMITTED: 'bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400',
  SIGNED: 'bg-purple-100 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400',
  TRANSMITTED: 'bg-amber-100 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ACCEPTED: 'bg-emerald-100 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  REJECTED: 'bg-red-100 dark:bg-red-500/10 text-red-600 dark:text-red-400',
  CANCELLED: 'bg-red-100 dark:bg-red-500/10 text-red-400',
}

export default function InvoiceDetailPage() {
  const tc = useTranslations('Common.errors')
  const t = useTranslations('Commercial.InvoiceDetail')
  const ti = useTranslations('Commercial.Invoices')
  const locale = useLocale()
  const params = useParams()
  const router = useRouter()
  const [invoice, setInvoice] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const { tenantId } = useSession()
  const [withholdingTax, setWithholdingTax] = useState<any>(null)
  const [generatingRS, setGeneratingRS] = useState(false)

  const fetchInvoice = async (id: string, tid: string) => {
    try {
      const res = await fetch(`/api/commercial/invoices?id=${id}`)
      if (res.ok) {
        const data = await res.json()
        setInvoice(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fetchRS = async (tid: string, invId: string) => {
    try {
      const res = await fetch(`/api/commercial/retenue-source?invoiceId=${invId}`)
      if (res.ok) {
        const data = await res.json()
        setWithholdingTax(Array.isArray(data) ? data[0] : data)
      }
    } catch (e) { console.error(e) }
  }

  useEffect(() => {
    const tid = tenantId
    if (params.id) { fetchInvoice(params.id as string, tid); fetchRS(tid, params.id as string) }
  }, [params.id])

  const handleNoteHonorairesPDF = async () => {
    if (!invoice || invoice.type !== 'HONORAIRES') return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/commercial/invoices/${invoice.id}/note-honoraires-pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Note_Honoraires_${invoice.number}.pdf`;
        a.click();
      } else {
        const err = await res.json();
        alert(tc('error_prefix', { error: err.error || tc('failed') }));
      }
    } catch (e) { alert(tc('connection_error')); }
    finally { setSubmitting(false); }
  };

  const handleGenerateRS = async () => {
    if (!invoice || !tenantId) return
    if (!confirm(t('generate_rs_prompt'))) return
    setGeneratingRS(true)
    try {
      const res = await fetch('/api/commercial/invoices/' + invoice.id + '/generer-rs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const result = await res.json()
      if (res.ok) {
        setWithholdingTax(result)
      } else {
        alert(tc('error_prefix', { error: result.error || tc('failed') }))
      }
    } catch (e) { alert(tc('connection_error')) }
    finally { setGeneratingRS(false) }
  }

  const handleTTNSubmit = async () => {
    if (!invoice) return
    if (!confirm(t('submit_ttn'))) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/commercial/invoices/${invoice.id}/ttn-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      })
      const result = await res.json()
      if (res.ok) {
        setInvoice(result)
      } else {
        alert(tc('error_prefix', { error: result.error || tc('submit_failed') }))
      }
    } catch (e) {
      alert(tc('connection_error'))
    } finally {
      setSubmitting(false)
    }
  }

  const exportTEIF = () => {
    if (!invoice) return
    let xml: string
    try {
    xml = generateTEIFXml({
      invoiceNumber: invoice.number,
      type: invoice.type,
      issueDate: new Date(invoice.date).toISOString().split('T')[0],
      tenant: {
        name: invoice.tenant?.name || '',
        matriculeFiscal: invoice.tenant?.matriculeFiscal || '',
        address: invoice.tenant?.address || '',
        city: invoice.tenant?.city || '',
        zipCode: invoice.tenant?.zipCode || '',
        phone: invoice.tenant?.phone || '',
      },
      client: {
        name: invoice.client?.name || '',
        matriculeFiscal: invoice.client?.matriculeFiscal || '',
        address: invoice.client?.address || '',
        city: invoice.client?.city || '',
      },
      items: invoice.items,
      totals: {
        subtotalHT: Number(invoice.subtotalHT),
        totalFodec: Number(invoice.totalFodec),
        totalVAT: Number(invoice.totalVAT),
        timbreFiscal: Number(invoice.timbreFiscal || 1),
        totalTTC: Number(invoice.totalTTC),
        vatSummary: invoice.vatSummary || {},
      },
    })
    } catch (e: any) {
      alert(e?.errors ? e.errors.join('\n') : (e?.message || 'TEIF'))
      return
    }
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${invoice.number}_TEIF.xml`
    a.click()
  }

  const fmt = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-TN' : 'fr-TN', { 
    style: 'currency', 
    currency: 'TND', 
    maximumFractionDigits: 3 
  })

  if (loading) return (
    <div className="p-8 flex items-center justify-center min-h-screen text-start">
      <div className="text-center">
        <RefreshCw className="w-8 h-8 animate-spin text-teal-500 mx-auto" />
        <p className="mt-4 text-stone-500 font-bold">{t('loading')}</p>
      </div>
    </div>
  )

  if (!invoice) return (
    <div className="p-8 text-center text-start">
      <p className="text-red-500 font-bold">{t('not_found')}</p>
      <Link href="/commercial/documents" className="text-teal-500 hover:underline mt-4 inline-block">{t('back_to_docs')}</Link>
    </div>
  )

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6 text-start">
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/commercial/documents" className="p-3 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl hover:bg-stone-50 dark:hover:bg-zinc-800 transition-all shadow-sm">
            <ArrowLeft className={`w-5 h-5 text-stone-600 dark:text-zinc-400 ${locale === 'ar' ? 'rotate-180' : ''}`} />
          </Link>
          <div className="flex-1">
            <h1 className="text-3xl font-black text-stone-900 dark:text-white tracking-tight">{t('title')} <span className="font-mono">{invoice.number}</span></h1>
            <p className="text-stone-500 dark:text-zinc-400 font-medium mt-1">{t('compliance')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 md:ms-auto">
          <button onClick={exportTEIF} className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl text-stone-600 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800 font-bold text-sm shadow-sm">
            <FileCode className="w-4 h-4" /> {t('teif_xml')}
          </button>
          {invoice.type === 'HONORAIRES' && (
            <button onClick={handleNoteHonorairesPDF} disabled={submitting}
              className="flex items-center gap-2 px-4 py-2.5 border border-amber-200 dark:border-amber-500/20 rounded-xl text-amber-700 dark:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 font-bold text-sm shadow-sm">
              <Receipt className="w-4 h-4" /> {t('fee_note_pdf')}
            </button>
          )}
          <a href={`/${locale}/print/invoice/${invoice.id}`} className="flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-xl text-stone-600 dark:text-zinc-400 hover:bg-stone-50 dark:hover:bg-zinc-800 font-bold text-sm shadow-sm">
            <Printer className="w-4 h-4" /> {t('print')}
          </a>
        </div>
      </div>

      {/* TTN Status Banner */}
      <div className={`rounded-2xl border p-6 ${invoice.ttnStatus === 'ACCEPTED' ? 'bg-emerald-50 dark:bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/20' : invoice.ttnStatus === 'REJECTED' ? 'bg-red-50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20' : 'bg-blue-50 dark:bg-blue-500/5 border-blue-200 dark:border-blue-500/20'}`}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            {invoice.ttnStatus === 'ACCEPTED' ? <CheckCircle className="w-8 h-8 text-emerald-600 dark:text-emerald-500" /> :
             invoice.ttnStatus === 'REJECTED' ? <XCircle className="w-8 h-8 text-red-600 dark:text-red-500" /> :
             invoice.ttnStatus === 'SUBMITTED' || invoice.ttnStatus === 'SIGNED' || invoice.ttnStatus === 'TRANSMITTED' ? <Clock className="w-8 h-8 text-blue-600 dark:text-blue-400 animate-pulse" /> :
             <Zap className="w-8 h-8 text-blue-500 dark:text-blue-400" />}
            <div>
              <p className="font-black text-stone-900 dark:text-white text-lg">{t('ttn_status_title')}</p>
              <p className={`text-sm font-bold ${invoice.ttnStatus === 'ACCEPTED' ? 'text-emerald-700 dark:text-emerald-400' : invoice.ttnStatus === 'REJECTED' ? 'text-red-700 dark:text-red-400' : 'text-blue-700 dark:text-blue-400'}`}>
                {t(`status_labels.${invoice.ttnStatus || 'DRAFT'}`)}
                {invoice.ttnReference ? ` ${t('ttn_ref', { ref: invoice.ttnReference })}` : ''}
              </p>
              {invoice.ttnErrorMessage && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 font-bold">⚠ {invoice.ttnErrorMessage}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {invoice.ttnStatus === 'ACCEPTED' && invoice.ttnQRCode && (
              <div className="text-center">
                <img src={invoice.ttnQRCode} alt="QR TTN" className="w-20 h-20 border border-stone-200 dark:border-zinc-800 rounded-xl" />
                <p className="text-[9px] text-stone-500 dark:text-zinc-500 mt-1 font-bold">{t('qr_ttn')}</p>
              </div>
            )}
            {(!invoice.ttnStatus || invoice.ttnStatus === 'DRAFT') && (
              <button
                onClick={handleTTNSubmit}
                disabled={submitting}
                className="flex items-center gap-2 px-6 py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-black text-sm shadow-lg shadow-teal-600/20 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                {submitting ? t('submitting') : t('submit_ttn')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Facture électronique El Fatoora (simulation) */}
      {!/QUOTE|DEVIS|DELIVERY|ORDER|PROFORMA/i.test(invoice.type || '') && (
        <EInvoicePanel invoiceId={invoice.id} onChanged={() => fetchInvoice(invoice.id, tenantId as string)} />
      )}

      {/* RS / TEJ Widget */}
      <div className="bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 rounded-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <DollarSign className="w-7 h-7 text-amber-600 dark:text-amber-500" />
            <div>
              <p className="font-black text-stone-900 dark:text-white">{t('rs_title')}</p>
              <p className="text-xs text-amber-700 dark:text-amber-500/80 font-medium">{t('tej_compliance')}</p>
            </div>
          </div>
          {!withholdingTax && (
            <button
              onClick={handleGenerateRS}
              disabled={generatingRS}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-white rounded-xl font-black text-xs shadow"
            >
              <Receipt className="w-4 h-4" />
              {generatingRS ? t('generating') : t('generate_rs')}
            </button>
          )}
        </div>
        {withholdingTax ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white dark:bg-zinc-950 rounded-xl p-3 border border-amber-100 dark:border-amber-500/10">
                <p className="text-[9px] font-black text-amber-600 dark:text-amber-500 uppercase tracking-widest">{t('rs_rate')}</p>
                <p className="text-lg font-black text-stone-900 dark:text-white">{(Number(withholdingTax.rate) * 100).toFixed(1)}%</p>
              </div>
              <div className="bg-white dark:bg-zinc-950 rounded-xl p-3 border border-amber-100 dark:border-amber-500/10">
                <p className="text-[9px] font-black text-amber-600 dark:text-amber-500 uppercase tracking-widest">{t('rs_amount')}</p>
                <p className="text-lg font-black text-stone-900 dark:text-white font-mono">{fmt(Number(withholdingTax.taxAmount))}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white dark:bg-zinc-950 rounded-xl p-3 border border-amber-100 dark:border-amber-500/10">
                <p className="text-[9px] font-black text-amber-600 dark:text-amber-500 uppercase tracking-widest">{t('net_paid')}</p>
                <p className="text-lg font-black text-stone-900 dark:text-white font-mono">{fmt(Number(withholdingTax.netAmount))}</p>
              </div>
              <div className="bg-white dark:bg-zinc-950 rounded-xl p-3 border border-amber-100 dark:border-amber-500/10">
                <p className="text-[9px] font-black text-amber-600 dark:text-amber-500 uppercase tracking-widest">{t('tej_status')}</p>
                <p className="text-sm font-black text-stone-900 dark:text-white capitalize">{withholdingTax.tejStatus || 'DRAFT'}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-3">
            <p className="text-xs text-amber-700 dark:text-amber-500 font-medium">{t('no_rs')}</p>
            <p className="text-[10px] text-amber-500 dark:text-amber-600 mt-1">{t('generate_rs_prompt')}</p>
          </div>
        )}
      </div>

      {/* Invoice Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 shadow-sm p-8 space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-100 dark:border-zinc-800 pb-6">
            <div>
              <p className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('number', { number: invoice.number })}</p>
              <p className="text-xs text-stone-400 dark:text-zinc-600 mt-1">{invoice.type} — {invoice.status}</p>
            </div>
            <div className="text-end">
              <p className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('date')}</p>
              <p className="text-sm font-bold text-stone-900 dark:text-white">{new Date(invoice.date).toLocaleDateString(locale === 'ar' ? 'ar-TN' : 'fr-TN')}</p>
              {invoice.dueDate && <p className="text-xs text-amber-600 dark:text-amber-500 mt-1 font-bold">{t('due_date')}: {new Date(invoice.dueDate).toLocaleDateString(locale === 'ar' ? 'ar-TN' : 'fr-TN')}</p>}
            </div>
          </div>

          {/* Supplier / Client */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="text-start">
              <p className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest mb-3">{t('issuer')}</p>
              <p className="font-black text-stone-900 dark:text-white">{invoice.tenant?.name}</p>
              <p className="text-sm text-stone-500 dark:text-zinc-400 font-mono mt-1">{invoice.tenant?.matriculeFiscal}</p>
              <p className="text-xs text-stone-400 dark:text-zinc-500 mt-1">{invoice.tenant?.address}, {invoice.tenant?.city}</p>
            </div>
            <div className="text-start">
              <p className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest mb-3">{t('client')}</p>
              <p className="font-black text-stone-900 dark:text-white flex items-center gap-2"><User className="w-4 h-4" /> {invoice.client?.name}</p>
              <p className="text-sm text-stone-500 dark:text-zinc-400 font-mono mt-1">{invoice.client?.matriculeFiscal || '—'}</p>
              <p className="text-xs text-stone-400 dark:text-zinc-500 mt-1">{invoice.client?.address}, {invoice.client?.city}</p>
            </div>
          </div>

          {/* Line Items */}
          <div className="overflow-x-auto">
            <p className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest mb-4">{t('items_title')}</p>
            <table className="w-full text-start">
              <thead>
                <tr className="bg-stone-50 dark:bg-zinc-950/50 text-[9px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">
                  <th className="px-4 py-3 text-start">{t('item_description')}</th>
                  <th className="px-4 py-3 text-center">{t('qty')}</th>
                  <th className="px-4 py-3 text-center">{t('unit')}</th>
                  <th className="px-4 py-3 text-end">{t('unit_price_ht')}</th>
                  <th className="px-4 py-3 text-center">{t('tva')}</th>
                  <th className="px-4 py-3 text-end">{t('total_ht')}</th>
                  <th className="px-4 py-3 text-end">{t('total_ttc')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                {invoice.items?.map((item: any, i: number) => (
                  <tr key={i} className="text-stone-700 dark:text-zinc-300">
                    <td className="px-4 py-3 text-sm">{item.description}</td>
                    <td className="px-4 py-3 text-sm text-center font-mono">{item.quantity}</td>
                    <td className="px-4 py-3 text-sm text-center font-mono">{item.unit}</td>
                    <td className="px-4 py-3 text-sm text-end font-mono">{fmt(Number(item.unitPriceHT))}</td>
                    <td className="px-4 py-3 text-sm text-center">{item.vatRate}%</td>
                    <td className="px-4 py-3 text-sm text-end font-mono font-bold">{fmt(Number(item.totalHT))}</td>
                    <td className="px-4 py-3 text-sm text-end font-mono font-bold text-stone-900 dark:text-white">{fmt(Number(item.totalTTC))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {invoice.notes && (
            <div className="bg-stone-50 dark:bg-zinc-950/50 rounded-xl p-4 text-start">
              <p className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest mb-2">{t('notes')}</p>
              <p className="text-sm text-stone-600 dark:text-zinc-400 font-medium">{invoice.notes}</p>
            </div>
          )}
        </div>

        {/* Totals Sidebar */}
        <div className="space-y-6">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-stone-200 dark:border-zinc-800 shadow-sm p-6 space-y-4 text-start">
            <p className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('totals_title')}</p>
            <div className="flex items-center justify-between text-sm"><span className="text-stone-500 dark:text-zinc-400">{t('subtotal_ht')}</span><span className="font-mono font-bold text-stone-900 dark:text-white">{fmt(Number(invoice.subtotalHT))}</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-stone-500 dark:text-zinc-400">{t('fodec')}</span><span className="font-mono text-amber-600 dark:text-amber-500 font-bold">{fmt(Number(invoice.totalFodec))}</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-stone-500 dark:text-zinc-400">{t('tva')}</span><span className="font-mono text-stone-600 dark:text-zinc-400 font-bold">{fmt(Number(invoice.totalVAT))}</span></div>
            <div className="flex items-center justify-between text-sm border-t border-stone-100 dark:border-zinc-800 pt-3"><span className="text-stone-500 dark:text-zinc-400">{t('timbre')}</span><span className="font-mono text-stone-400 dark:text-zinc-600 font-bold">{fmt(Number(invoice.timbreFiscal || 1))}</span></div>
            <div className="p-4 bg-teal-50 dark:bg-teal-500/10 border border-teal-200 dark:border-teal-500/20 rounded-xl">
              <p className="text-[10px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest">{t('total_ttc_bold')}</p>
              <p className="text-2xl font-black text-teal-900 dark:text-teal-400 mt-1">{fmt(Number(invoice.totalTTC))}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
