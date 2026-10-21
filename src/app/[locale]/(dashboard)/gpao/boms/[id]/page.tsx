'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { ChevronLeft, Layers } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { useApiResource } from '@/hooks/useApiResource'
import { readApiError } from '@/lib/client-errors'
import { DetailLoading, DetailError, DetailNotFound, InfoRow } from '@/components/ui/DetailStates'

interface BOMItem { id: string; productId: string; quantity: string | number }
interface BOM { id: string; productId: string; version: string; isActive: boolean; createdAt?: string; updatedAt?: string; items: BOMItem[] }
interface Product { id: string; name: string; sku?: string | null; unit?: string | null }

/** Fiche nomenclature GPAO (GET/PUT /api/gpao/boms/[id]). */
export default function BomDetailPage() {
  const t = useTranslations('GPAO.boms')
  const locale = useLocale()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { data: bom, setData, loading, error, notFound, reload } = useApiResource<BOM>(id ? `/api/gpao/boms/${id}` : null)
  const [products, setProducts] = useState<Record<string, Product>>({})
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stock/products')
      .then(r => (r.ok ? r.json() : []))
      .then((list: Product[]) => { if (Array.isArray(list)) setProducts(Object.fromEntries(list.map(p => [p.id, p]))) })
      .catch(() => { /* noms de produits facultatifs */ })
  }, [])

  async function toggleActive() {
    if (!bom) return
    setSaving(true)
    setActionError(null)
    try {
      const res = await fetch(`/api/gpao/boms/${bom.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !bom.isActive }),
      })
      if (!res.ok) { setActionError(await readApiError(res, locale)); return }
      setData({ ...bom, isActive: !bom.isActive })
    } catch {
      setActionError(t('detail.save_error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <DetailLoading />
  if (notFound) return <DetailNotFound backHref="/gpao/boms" backLabel={t('detail.back')} />
  if (error || !bom) return <DetailError message={error || t('detail.load_error')} onRetry={reload} />

  const product = products[bom.productId]

  return (
    <div className="p-4 sm:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/gpao/boms" className="p-2 rounded-xl text-stone-500 hover:bg-stone-100" aria-label={t('detail.back')}>
            <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight flex items-center gap-3">
              <Layers className="w-7 h-7 text-indigo-600" /> {product?.name || t('unknown_product_title')}
            </h1>
            <p className="mt-1 text-sm font-bold text-stone-600">{t('detail.version', { version: bom.version })}{product?.sku ? ` · ${product.sku}` : ''}</p>
          </div>
        </div>
        <button onClick={toggleActive} disabled={saving}
          className={`px-4 py-2 rounded-xl text-sm font-bold border disabled:opacity-60 ${bom.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-stone-100 text-stone-600 border-stone-200'}`}>
          {bom.isActive ? t('detail.active') : t('detail.inactive')} · {bom.isActive ? t('detail.deactivate') : t('detail.activate')}
        </button>
      </div>

      {actionError && <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{actionError}</div>}

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
        <dl>
          <InfoRow label={t('form.product_to_make')} value={product?.name || t('unknown_product')} />
          <InfoRow label={t('form.version')} value={bom.version} />
          <InfoRow label={t('detail.components_count')} value={bom.items?.length ?? 0} />
        </dl>
      </section>

      <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <h2 className="font-black text-stone-900 p-6 pb-3">{t('form.components')}</h2>
        {(bom.items?.length ?? 0) === 0 ? (
          <p className="px-6 pb-6 text-sm text-stone-500">{t('form.need_component')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-stone-50 border-y border-stone-200 text-xs font-bold text-stone-500 uppercase">
                  <th className="px-6 py-3 text-start">{t('detail.component')}</th>
                  <th className="px-6 py-3 text-start">{t('detail.reference')}</th>
                  <th className="px-6 py-3 text-end">{t('form.qty')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {bom.items.map(it => {
                  const p = products[it.productId]
                  return (
                    <tr key={it.id}>
                      <td className="px-6 py-3 font-bold text-stone-900">{p?.name || t('unknown_product')}</td>
                      <td className="px-6 py-3 font-mono text-stone-600">{p?.sku || '—'}</td>
                      <td className="px-6 py-3 text-end text-stone-700 whitespace-nowrap">{String(it.quantity)}{p?.unit ? ` ${p.unit}` : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
