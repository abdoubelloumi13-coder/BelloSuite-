'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { ChevronLeft, Settings, Wrench } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { useApiResource } from '@/hooks/useApiResource'
import { readApiError } from '@/lib/client-errors'
import { DetailLoading, DetailError, DetailNotFound, InfoRow } from '@/components/ui/DetailStates'

type AssetStatus = 'ACTIVE' | 'IN_MAINTENANCE' | 'BROKEN' | 'RETIRED'
interface WorkOrder { id: string; title: string; type: string; status: string; priority: string; scheduledDate?: string | null; completedDate?: string | null; assignedTo?: string | null }
interface Asset {
  id: string; code: string; name: string; description?: string | null; category?: string | null; location?: string | null
  purchaseDate?: string | null; purchaseValue?: string | number | null; salvageValue?: string | number | null; usefulLife?: number | null
  amortizationMethod?: string | null; warrantyEnd?: string | null; status: AssetStatus; isActive: boolean; workOrders?: WorkOrder[]
}

const STATUSES: AssetStatus[] = ['ACTIVE', 'IN_MAINTENANCE', 'BROKEN', 'RETIRED']
const statusColors: Record<AssetStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  IN_MAINTENANCE: 'bg-amber-100 text-amber-800 border-amber-200',
  BROKEN: 'bg-red-100 text-red-800 border-red-200',
  RETIRED: 'bg-stone-100 text-stone-500 border-stone-200',
}

/** Fiche équipement GMAO (GET/PUT /api/gmao/assets/[id]). */
export default function AssetDetailPage() {
  const t = useTranslations('GMAO.assets')
  const tw = useTranslations('GMAO.work_orders')
  const locale = useLocale()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { data: asset, setData, loading, error, notFound, reload } = useApiResource<Asset>(id ? `/api/gmao/assets/${id}` : null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleDateString(`${locale}-TN`) : '—'
  const fmtMoney = (v?: string | number | null) => v === null || v === undefined || v === '' ? '—'
    : `${Number(v).toLocaleString(`${locale}-TN`, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} TND`

  async function changeStatus(status: AssetStatus) {
    if (!asset || status === asset.status) return
    setSaving(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/gmao/assets/${asset.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      })
      if (!res.ok) { setActionError(await readApiError(res, locale)); return }
      setData({ ...asset, status })
    } catch {
      setActionError(t('detail.save_error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <DetailLoading />
  if (notFound) return <DetailNotFound backHref="/gmao/assets" backLabel={t('detail.back')} />
  if (error || !asset) return <DetailError message={error || t('detail.load_error')} onRetry={reload} />

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/gmao/assets" className="p-2 rounded-xl text-stone-500 hover:bg-stone-100" aria-label={t('detail.back')}>
            <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight flex items-center gap-3">
              <Settings className="w-7 h-7 text-teal-600" /> {asset.name}
            </h1>
            <p className="mt-1 font-mono text-sm font-bold text-stone-600">{asset.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="asset-status" className="text-xs font-bold text-stone-500 uppercase">{t('status')}</label>
          <select id="asset-status" value={asset.status} disabled={saving} onChange={e => changeStatus(e.target.value as AssetStatus)}
            className={`px-3 py-2 rounded-xl text-sm font-bold border ${statusColors[asset.status]}`}>
            {STATUSES.map(s => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
          </select>
        </div>
      </div>

      {actionError && <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{actionError}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h2 className="font-black text-stone-900 mb-3">{t('form.details')}</h2>
          <dl>
            <InfoRow label={t('detail.category')} value={asset.category || '—'} />
            <InfoRow label={t('location')} value={asset.location || '—'} />
            <InfoRow label={t('form.description')} value={asset.description || '—'} />
          </dl>
        </section>
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h2 className="font-black text-stone-900 mb-3">{t('form.acquisition')}</h2>
          <dl>
            <InfoRow label={t('form.purchase_date')} value={fmtDate(asset.purchaseDate)} />
            <InfoRow label={t('form.acquisition_value')} value={fmtMoney(asset.purchaseValue)} />
            <InfoRow label={t('form.residual_value')} value={fmtMoney(asset.salvageValue)} />
            <InfoRow label={t('form.lifespan')} value={asset.usefulLife ?? '—'} />
            <InfoRow label={t('form.warranty_end')} value={fmtDate(asset.warrantyEnd)} />
          </dl>
        </section>
      </div>

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-6 pb-3">
          <h2 className="font-black text-stone-900 flex items-center gap-2"><Wrench className="w-4 h-4 text-teal-600" /> {t('work_orders')}</h2>
          <Link href="/gmao/work-orders" className="text-sm font-semibold text-teal-600 hover:text-teal-700">{t('detail.all_work_orders')}</Link>
        </div>
        {(asset.workOrders?.length ?? 0) === 0 ? (
          <p className="px-6 pb-6 text-sm text-stone-500">{tw('empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="bg-stone-50 border-y border-stone-200 text-xs font-bold text-stone-500 uppercase">
                  <th className="px-6 py-3 text-start">{tw('form.job_title')}</th>
                  <th className="px-6 py-3 text-start">{tw('form.type')}</th>
                  <th className="px-6 py-3 text-start">{tw('form.status')}</th>
                  <th className="px-6 py-3 text-start">{tw('form.scheduled')}</th>
                  <th className="px-6 py-3 text-start">{tw('form.assigned_to')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {asset.workOrders!.map(wo => (
                  <tr key={wo.id}>
                    <td className="px-6 py-3 font-bold text-stone-900">{wo.title}</td>
                    <td className="px-6 py-3 text-stone-600">{tw.has(`types.${wo.type}`) ? tw(`types.${wo.type}`) : wo.type}</td>
                    <td className="px-6 py-3 text-stone-600">{tw.has(`statuses.${wo.status}`) ? tw(`statuses.${wo.status}`) : wo.status}</td>
                    <td className="px-6 py-3 text-stone-600 whitespace-nowrap">{fmtDate(wo.scheduledDate)}</td>
                    <td className="px-6 py-3 text-stone-600">{wo.assignedTo || tw('unassigned')}</td>
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
