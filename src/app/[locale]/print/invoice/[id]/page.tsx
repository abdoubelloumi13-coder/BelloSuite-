'use client'

/**
 * Version imprimable d'une facture (A4, window.print) avec les mentions tunisiennes :
 * matricule fiscal émetteur/client, HT, FODEC, TVA par taux, droit de timbre, TTC,
 * et, si la facture a été « validée » par le simulateur TTN, le QR et la référence TTN
 * accompagnés de la mention « Mode simulation — non valable fiscalement ».
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface EStatus { step: string; referenceTTN: string | null; qrDataUrl: string | null; acceptedAt: string | null }

export default function PrintInvoicePage() {
  const t = useTranslations('EInvoice.print')
  const te = useTranslations('EInvoice')
  const locale = useLocale()
  const params = useParams()
  const id = params.id as string
  const [invoice, setInvoice] = useState<any>(null)
  const [estatus, setEstatus] = useState<EStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [inv, es] = await Promise.all([
          fetch(`/api/commercial/invoices?id=${encodeURIComponent(id)}`),
          fetch(`/api/commercial/invoices/${encodeURIComponent(id)}/einvoice`).catch(() => null),
        ])
        if (!inv.ok) throw new Error((await inv.json().catch(() => null))?.error || t('not_found'))
        const data = await inv.json()
        const st = es && es.ok ? await es.json() : null
        if (!cancelled) { setInvoice(data); setEstatus(st); setReady(true) }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t('not_found'))
      }
    })()
    return () => { cancelled = true }
  }, [id, t])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => window.print(), 400)
    return () => clearTimeout(timer)
  }, [ready])

  const nf = useMemo(() => new Intl.NumberFormat(locale === 'ar' ? 'ar-TN' : 'fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }), [locale])
  const money = (v: unknown) => `${nf.format(Number(v || 0))} TND`
  const date = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('fr-TN', { timeZone: 'Africa/Tunis' }) : '—')

  const vatByRate = useMemo(() => {
    const m = new Map<number, { base: number; amount: number }>()
    for (const it of invoice?.items || []) {
      const rate = Number(it.vatRate || 0)
      const cur = m.get(rate) ?? { base: 0, amount: 0 }
      cur.base += Number(it.totalHT || 0) + Number(it.fodecAmount || 0)
      cur.amount += Number(it.vatAmount || 0)
      m.set(rate, cur)
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0])
  }, [invoice])

  if (error) return <p className="p-8 text-red-600 font-bold">{error}</p>
  if (!invoice) return <p className="p-8 text-stone-500">{t('loading')}</p>

  const isCredit = /CREDIT|AVOIR/i.test(invoice.type || '')
  const validated = estatus?.step === 'validated' && estatus.referenceTTN
  const tenant = invoice.tenant || {}
  const client = invoice.client || {}

  return (
    <div className="min-h-screen bg-stone-100 print:bg-white text-stone-900">
      <style>{`@page { size: A4; margin: 14mm; } @media print { .no-print { display: none !important; } body { background: #fff; } body * { visibility: hidden; } #print-invoice, #print-invoice * { visibility: visible; } #print-invoice { position: absolute; inset: 0 auto auto 0; width: 100%; } }`}</style>
      <div className="no-print sticky top-0 z-10 flex items-center justify-between gap-3 bg-white border-b border-stone-200 px-6 py-3">
        <p className="text-sm font-bold text-stone-600">{t('toolbar', { number: invoice.number })}</p>
        <button type="button" onClick={() => window.print()} className="px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-black">{t('print_button')}</button>
      </div>

      <article id="print-invoice" className="mx-auto my-6 print:my-0 max-w-[210mm] bg-white shadow print:shadow-none p-10 print:p-0 text-[12px] leading-relaxed">
        <header className="flex justify-between gap-6 border-b-2 border-stone-800 pb-4">
          <div>
            <p className="text-lg font-black">{tenant.name}</p>
            <p>{[tenant.address, tenant.zipCode, tenant.city].filter(Boolean).join(', ')}</p>
            {tenant.phone && <p>{t('phone')} : {tenant.phone}</p>}
            {tenant.email && <p>{tenant.email}</p>}
            <p className="font-bold mt-1">{t('mf')} : <span className="font-mono">{tenant.matriculeFiscal || '—'}</span></p>
          </div>
          <div className="text-end">
            <p className="text-2xl font-black uppercase">{isCredit ? t('credit_note') : t('invoice')}</p>
            <p className="font-mono font-bold">N° {invoice.number}</p>
            <p>{t('date')} : {date(invoice.date)}</p>
            {invoice.dueDate && <p>{t('due_date')} : {date(invoice.dueDate)}</p>}
          </div>
        </header>

        <section className="mt-4 grid grid-cols-2 gap-6">
          <div />
          <div className="border border-stone-300 rounded p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-stone-500">{t('client')}</p>
            <p className="font-black">{client.name}</p>
            <p>{[client.address, client.zipCode, client.city].filter(Boolean).join(', ')}</p>
            <p>{t('client_mf')} : <span className="font-mono">{client.matriculeFiscal || '—'}</span></p>
          </div>
        </section>

        <table className="mt-6 w-full border-collapse">
          <thead>
            <tr className="bg-stone-100 text-[10px] uppercase">
              <th className="border border-stone-300 px-2 py-1 text-start">{t('designation')}</th>
              <th className="border border-stone-300 px-2 py-1">{t('qty')}</th>
              <th className="border border-stone-300 px-2 py-1 text-end">{t('unit_price_ht')}</th>
              <th className="border border-stone-300 px-2 py-1">{t('vat_rate')}</th>
              <th className="border border-stone-300 px-2 py-1 text-end">{t('fodec')}</th>
              <th className="border border-stone-300 px-2 py-1 text-end">{t('total_ht')}</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.items || []).map((it: any, i: number) => (
              <tr key={it.id || i}>
                <td className="border border-stone-300 px-2 py-1">{it.description}</td>
                <td className="border border-stone-300 px-2 py-1 text-center font-mono">{Number(it.quantity)} {it.unit && it.unit !== 'EA' ? it.unit : ''}</td>
                <td className="border border-stone-300 px-2 py-1 text-end font-mono">{nf.format(Number(it.unitPriceHT || 0))}</td>
                <td className="border border-stone-300 px-2 py-1 text-center">{Number(it.vatRate || 0)} %</td>
                <td className="border border-stone-300 px-2 py-1 text-end font-mono">{Number(it.fodecAmount || 0) ? nf.format(Number(it.fodecAmount)) : '—'}</td>
                <td className="border border-stone-300 px-2 py-1 text-end font-mono">{nf.format(Number(it.totalHT || 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="mt-4 grid grid-cols-2 gap-6 items-start">
          <div>
            {vatByRate.length > 0 && (
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-stone-100 uppercase text-[10px]">
                    <th className="border border-stone-300 px-2 py-1">{t('vat_rate')}</th>
                    <th className="border border-stone-300 px-2 py-1 text-end">{t('vat_base')}</th>
                    <th className="border border-stone-300 px-2 py-1 text-end">{t('vat_amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {vatByRate.map(([rate, v]) => (
                    <tr key={rate}>
                      <td className="border border-stone-300 px-2 py-1 text-center">{rate} %</td>
                      <td className="border border-stone-300 px-2 py-1 text-end font-mono">{nf.format(v.base)}</td>
                      <td className="border border-stone-300 px-2 py-1 text-end font-mono">{nf.format(v.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr><td className="px-2 py-1">{t('total_ht')}</td><td className="px-2 py-1 text-end font-mono">{money(invoice.subtotalHT)}</td></tr>
              <tr><td className="px-2 py-1">{t('fodec')}</td><td className="px-2 py-1 text-end font-mono">{money(invoice.totalFodec)}</td></tr>
              <tr><td className="px-2 py-1">{t('total_vat')}</td><td className="px-2 py-1 text-end font-mono">{money(invoice.totalVAT)}</td></tr>
              <tr><td className="px-2 py-1">{t('timbre')}</td><td className="px-2 py-1 text-end font-mono">{money(invoice.timbreFiscal ?? 1)}</td></tr>
              <tr className="border-t-2 border-stone-800 font-black text-[14px]"><td className="px-2 py-1">{t('total_ttc')}</td><td className="px-2 py-1 text-end font-mono">{money(invoice.totalTTC)}</td></tr>
            </tbody>
          </table>
        </section>

        {invoice.notes && <p className="mt-4 text-[11px]"><span className="font-bold">{t('notes')} :</span> {invoice.notes}</p>}

        {validated && (
          <section className="mt-6 flex items-center gap-4 border border-orange-300 rounded p-3">
            {estatus?.qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={estatus.qrDataUrl} alt={te('qr_alt')} className="w-24 h-24" />
            )}
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-stone-500">{t('ttn_reference')}</p>
              <p className="font-mono font-black">{estatus?.referenceTTN}</p>
              {estatus?.acceptedAt && <p>{t('ttn_date')} : {new Date(estatus.acceptedAt).toLocaleString('fr-TN', { timeZone: 'Africa/Tunis' })}</p>}
              <p className="font-black text-orange-700">{te('simulation_banner')}</p>
            </div>
          </section>
        )}

        <footer className="mt-8 border-t border-stone-300 pt-2 text-[10px] text-stone-500 text-center">
          {tenant.name} — {t('mf')} {tenant.matriculeFiscal || '—'}{tenant.phone ? ` — ${tenant.phone}` : ''}
        </footer>
      </article>
    </div>
  )
}
