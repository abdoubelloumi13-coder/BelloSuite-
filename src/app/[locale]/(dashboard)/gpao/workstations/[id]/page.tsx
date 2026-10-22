'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { ChevronLeft, Factory } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { useApiResource } from '@/hooks/useApiResource'
import { readApiError } from '@/lib/client-errors'
import { DetailLoading, DetailError, DetailNotFound, InfoRow } from '@/components/ui/DetailStates'

interface ProductionOrder { id: string; productId: string; quantity: string | number; status: string; plannedStartDate?: string | null; plannedEndDate?: string | null }
interface WorkStation {
  id: string; code: string; name: string; description?: string | null; location?: string | null
  capacity: string | number; isActive: boolean; productionOrders?: ProductionOrder[]
}

const ORDER_STATUS_KEY: Record<string, string> = { PENDING: 'pending', IN_PROGRESS: 'in_progress', COMPLETED: 'completed', CANCELLED: 'cancelled' }

/** Fiche poste de charge GPAO (GET/PUT /api/gpao/workstations/[id]). */
export default function WorkstationDetailPage() {
  const t = useTranslations('GPAO.workstations')
  const to = useTranslations('GPAO.orders')
  const locale = useLocale()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { data: ws, setData, loading, error, notFound, reload } = useApiResource<WorkStation>(id ? `/api/gpao/workstations/${id}` : null)
  const [products, setProducts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stock/products')
      .then(r => (r.ok ? r.json() : []))
      .then((list: Array<{ id: string; name: string }>) => {
        if (Array.isArray(list)) setProducts(Object.fromEntries(list.map(p => [p.id, p.name])))
      })
      .catch(() => { /* noms de produits facultatifs */ })
  }, [])

  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString(`${locale}-TN`) : to('not_planned')

  async function toggleActive() {
    if (!ws) return
    setSaving(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/gpao/workstations/${ws.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !ws.isActive }),
      })
      if (!res.ok) { setActionError(await readApiError(res, locale)); return }
      setData({ ...ws, isActive: !ws.isActive })
    } catch {
      setActionError(t('detail.save_error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <DetailLoading />
  if (notFound) return <DetailNotFound backHref="/gpao/workstations" backLabel={t('detail.back')} />
  if (error || !ws) return <DetailError message={error || t('detail.load_error')} onRetry={reload} />

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/gpao/workstations" className="p-2 rounded-xl text-stone-500 hover:bg-stone-100" aria-label={t('detail.back')}>
            <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight flex items-center gap-3">
              <Factory className="w-7 h-7 text-slate-700" /> {ws.name}
            </h1>
            <p className="mt-1 font-mono text-sm font-bold text-stone-600">{ws.code}</p>
          </div>
        </div>
        <button onClick={toggleActive} disabled={saving}
          className={`px-4 py-2 rounded-xl text-sm font-bold border disabled:opacity-60 ${ws.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-100 text-stone-600 border-stone-200'}`}>
          {ws.isActive ? t('active') : t('inactive')} · {ws.isActive ? t('detail.deactivate') : t('detail.activate')}
        </button>
      </div>

      {actionError && <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{actionError}</div>}

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
        <dl>
          <InfoRow label={t('form.location')} value={ws.location || t('undefined_location')} />
          <InfoRow label={t('form.capacity')} value={String(ws.capacity)} />
          <InfoRow label={t('form.description')} value={ws.description || '—'} />
        </dl>
      </section>

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-6 pb-3">
          <h2 className="font-black text-stone-900">{to('title')}</h2>
          <Link href="/gpao/production-orders" className="text-sm font-semibold text-slate-700 hover:text-slate-900">{t('detail.all_orders')}</Link>
        </div>
        {(ws.productionOrders?.length ?? 0) === 0 ? (
          <p className="px-6 pb-6 text-sm text-stone-500">{to('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-y border-stone-200 text-xs font-bold text-stone-500 uppercase">
                  <th className="px-6 py-3 text-start">{to('form.product')}</th>
                  <th className="px-6 py-3 text-end">{to('form.qty')}</th>
                  <th className="px-6 py-3 text-start">{t('detail.status')}</th>
                  <th className="px-6 py-3 text-start">{to('form.start')}</th>
                  <th className="px-6 py-3 text-start">{to('form.end')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {ws.productionOrders!.map(o => (
                  <tr key={o.id}>
                    <td className="px-6 py-3 font-bold text-stone-900">{products[o.productId] || to('unknown_product')}</td>
                    <td className="px-6 py-3 text-end text-stone-700">{String(o.quantity)}</td>
                    <td className="px-6 py-3 text-stone-600">{ORDER_STATUS_KEY[o.status] ? to(ORDER_STATUS_KEY[o.status]) : o.status}</td>
                    <td className="px-6 py-3 text-stone-600 whitespace-nowrap">{fmtDate(o.plannedStartDate)}</td>
                    <td className="px-6 py-3 text-stone-600 whitespace-nowrap">{fmtDate(o.plannedEndDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
