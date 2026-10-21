'use client'

import { useState, useEffect, useRef } from 'react'
import { apiFormError, fetchJson } from '@/lib/form-errors'
import { useRouter } from '@/i18n/routing'
import { Link } from '@/i18n/routing'
import { useTranslations } from 'next-intl'
import { ArrowLeft, Plus, Trash2, Save, Package, Image as ImageIcon, Hash, DollarSign, Layers, X } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useStockReferentials, CategoryInput, UnitSelect } from '@/components/stock/ProductFields'

type Variant = {
  id: string
  name: string
  sku: string
  price: number
  stock: number
  attributes: Record<string, string>
}

export default function NewProductPage() {
  const t = useTranslations()
  const tm = useTranslations('StockMod')
  const refs = useStockReferentials()
  const router = useRouter()
  const { tenantId } = useSession()
  const [loading, setLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<any[]>([])

  const [form, setForm] = useState({
    code: '', barcode: '', name: '', description: '',
    category: '', unit: 'unit', purchasePrice: '', salePrice: '',
    vatRate: '19', fodec: false, minStock: '', initialStock: '', reorderPoint: '', reorderQty: '', warehouseId: '',
  })
  const [images, setImages] = useState<string[]>([])
  const [newImage, setNewImage] = useState('')
  const [variants, setVariants] = useState<Variant[]>([])
  const [newVariant, setNewVariant] = useState({ name: '', sku: '', price: '', stock: '', size: '', color: '' })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const errorRef = useRef<HTMLDivElement>(null)
  // Affiche l'erreur À L'ÉCRAN : la bannière est en haut d'un long formulaire, le bouton en bas.
  const showError = (msg: string, fields: Record<string, string> = {}) => {
    setError(msg); setFieldErrors(fields)
    requestAnimationFrame(() => errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }
  const fieldErr = (k: string) => fieldErrors[k] ? <p className="mt-1 text-xs font-bold text-red-600 text-start">{fieldErrors[k]}</p> : null

  useEffect(() => {
    const tid = tenantId
    fetch(`/api/commercial/suppliers`).then(r => { if (r.ok) r.json().then(d => setSuppliers(d)) }).catch(() => {})
  }, [])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const addImage = () => {
    if (newImage.trim()) setImages(im => [...im, newImage.trim()])
    setNewImage('')
  }

  const addVariant = () => {
    if (!newVariant.name || !newVariant.sku) return
    const v: Variant = {
      id: crypto.randomUUID(),
      name: newVariant.name,
      sku: newVariant.sku,
      price: Number(newVariant.price) || 0,
      stock: Number(newVariant.stock) || 0,
      attributes: { ...(newVariant.size && { Size: newVariant.size }), ...(newVariant.color && { Couleur: newVariant.color }) },
    }
    setVariants(vs => [...vs, v])
    setNewVariant({ name: '', sku: '', price: '', stock: '', size: '', color: '' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const missing: Record<string, string> = {}
    if (!form.code.trim()) missing.code = 'Champ obligatoire'
    if (!form.name.trim()) missing.name = 'Champ obligatoire'
    if (Object.keys(missing).length) { showError(t('Stock.required_fields_error'), missing); return }
    setLoading(true)
    setError(''); setFieldErrors({})
    // Ne jamais ignorer une réponse non-OK : bannière + erreurs par champ, en français.
    const r = await fetchJson('/api/stock/products', {
      method: 'POST',
      body: JSON.stringify({ ...form, tenantId, images, variants }),
    })
    if (r.ok) {
      router.push('/stock/products')
      return
    }
    const fe = apiFormError(r.status, r.data, {
      code: t('Stock.code_sku'), name: t('Stock.product_name'), category: t('Stock.category_label'), unit: t('Stock.unit'),
      purchasePrice: t('Stock.purchase_price_ht'), salePrice: t('Stock.sale_price_ht'), vatRate: t('Stock.tva'),
      initialStock: t('Stock.initial_stock'), minStock: t('Stock.min_stock_alert'), warehouseId: tm('initial_warehouse'),
    })
    showError(fe.message, fe.fields)
    setLoading(false)
  }

  const inputCls = "w-full bg-white border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 text-sm outline-none focus:border-teal-500/50"
  const labelCls = "block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2 text-start"

  return (
    <div className="max-w-4xl mx-auto text-zinc-900 font-sans">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/stock/products" className="p-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-xl transition-all rtl:rotate-180">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="text-start">
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">{t('Stock.new_product_title')}</h1>
          <p className="text-zinc-500 font-medium text-sm mt-1">{t('Stock.new_product_description')}</p>
        </div>
      </div>

      {error && <div ref={errorRef} role="alert" className="mb-6 px-6 py-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-700 text-sm font-bold text-start">{error}</div>}

      <form onSubmit={handleSubmit} noValidate className="space-y-8">
        {/* Infos générales */}
        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8">
          <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-6 rtl:flex-row-reverse">
            <Package className="w-5 h-5 text-teal-700" /> {t('Stock.product_info')}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelCls}>{t('Stock.code_sku')} *</label>
              <div className="relative">
                <Hash className="w-4 h-4 absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input value={form.code} onChange={e => set('code', e.target.value)} placeholder="PROD-001" className={inputCls + " ps-10" + (fieldErrors.code ? ' border-red-500' : '')} aria-invalid={!!fieldErrors.code} required />
              </div>
              {fieldErr('code')}
            </div>
            <div>
              <label className={labelCls}>{t('Stock.barcode')}</label>
              <input value={form.barcode} onChange={e => set('barcode', e.target.value)} placeholder="6291041500212" className={inputCls} />
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>{t('Stock.product_name')} *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('Stock.product_name')} className={inputCls + (fieldErrors.name ? ' border-red-500' : '')} aria-invalid={!!fieldErrors.name} required />
              {fieldErr('name')}
            </div>
            <div className="md:col-span-2">
              <label className={labelCls}>{t('Stock.description_label')}</label>
              <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder={t('Stock.description_label')} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{t('Stock.category_label')}</label>
              <CategoryInput value={form.category} onChange={v => set('category', v)} className={inputCls} categories={refs.categories} />
              <p className="mt-1 text-[11px] text-zinc-500 text-start">Facultatif — une nouvelle catégorie est créée automatiquement.</p>
              {fieldErr('category')}
            </div>
            <div>
              <label className={labelCls}>{t('Stock.unit')}</label>
              <UnitSelect value={form.unit} onChange={v => set('unit', v)} className={inputCls} units={refs.units} />
              {fieldErr('unit')}
            </div>
          </div>
        </div>

        {/* Prix */}
        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8">
          <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-6 rtl:flex-row-reverse">
            <DollarSign className="w-5 h-5 text-emerald-700" /> {t('Stock.pricing')}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div>
              <label className={labelCls}>{t('Stock.purchase_price_ht')}</label>
              <input type="number" step="0.001" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)} placeholder="0.000" className={inputCls} />
              {fieldErr('purchasePrice')}
            </div>
            <div>
              <label className={labelCls}>{t('Stock.sale_price_ht')}</label>
              <input type="number" step="0.001" value={form.salePrice} onChange={e => set('salePrice', e.target.value)} placeholder="0.000" className={inputCls} />
              {fieldErr('salePrice')}
            </div>
            <div>
              <label className={labelCls}>{t('Stock.tva')}</label>
              <select value={form.vatRate} onChange={e => set('vatRate', e.target.value)} className={inputCls}>
                <option value="0">0%</option>
                <option value="7">7%</option>
                <option value="13">13%</option>
                <option value="19">19%</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>{t('Stock.initial_stock')}</label>
              <input type="number" step="any" value={form.initialStock} onChange={e => set('initialStock', e.target.value)} placeholder="0" className={inputCls} />
              {fieldErr('initialStock')}
            </div>
            <div>
              <label className={labelCls}>{t('Stock.min_stock_alert')}</label>
              <input type="number" step="any" value={form.minStock} onChange={e => set('minStock', e.target.value)} placeholder="0" className={inputCls} />
              {fieldErr('minStock')}
            </div>
            <div>
              <label className={labelCls}>{tm('reorder_point')}</label>
              <input type="number" step="any" min="0" value={form.reorderPoint} onChange={e => set('reorderPoint', e.target.value)} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{tm('reorder_qty')}</label>
              <input type="number" step="any" min="0" value={form.reorderQty} onChange={e => set('reorderQty', e.target.value)} placeholder="0" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{tm('initial_warehouse')}</label>
              <select value={form.warehouseId} onChange={e => set('warehouseId', e.target.value)} className={inputCls}>
                <option value="">{tm('default_warehouse')}</option>
                {refs.warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
              {refs.warehouses.length === 0 && <p className="mt-1 text-[11px] text-zinc-500 text-start">Aucun dépôt : un « Dépôt principal » sera créé automatiquement.</p>}
              {fieldErr('warehouseId')}
            </div>
            <div className="flex items-center gap-3 pt-6 text-start">
              <input type="checkbox" id="fodec" checked={form.fodec} onChange={e => set('fodec', e.target.checked)} className="w-5 h-5 rounded accent-teal-500" />
              <label htmlFor="fodec" className="text-zinc-600 text-sm font-bold cursor-pointer">{t('Stock.fodec_applicable')}</label>
            </div>
          </div>
        </div>

        {/* Images */}
        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8">
          <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-6 rtl:flex-row-reverse">
            <ImageIcon className="w-5 h-5 text-purple-700" /> {t('Stock.images_label')}
          </h2>
          <div className="flex gap-3 mb-4">
            <input value={newImage} onChange={e => setNewImage(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addImage())} placeholder={t('Stock.image_url_placeholder')} className={inputCls + " flex-1"} />
            <button type="button" onClick={addImage} className="px-5 py-3 bg-zinc-200 hover:bg-zinc-300 text-zinc-900 rounded-xl font-bold text-sm"><Plus className="w-4 h-4" /></button>
          </div>
          {images.length > 0 && (
            <div className="flex gap-3 flex-wrap">
              {images.map((url, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden bg-zinc-100">
                  <img src={url} className="w-full h-full object-cover" alt="" />
                  <button type="button" onClick={() => setImages(im => im.filter((_, j) => j !== i))} className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4 text-red-700" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Variantes */}
        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8">
          <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-6 rtl:flex-row-reverse">
            <Layers className="w-5 h-5 text-amber-700" /> {t('Stock.variants_label')}
          </h2>
          {variants.length > 0 && (
            <div className="mb-6 space-y-2">
              {variants.map((v, i) => (
                <div key={v.id} className="flex items-center gap-4 bg-zinc-50 rounded-xl px-4 py-3 text-start">
                  <span className="font-bold text-zinc-900 text-sm flex-1">{v.name}</span>
                  <span className="text-zinc-500 text-xs font-mono">{v.sku}</span>
                  <span className="text-emerald-700 text-sm font-mono">{Number(v.price).toFixed(3)} TND</span>
                  <span className="text-zinc-600 text-xs">{t('Stock.inventory')}: {v.stock}</span>
                  <button type="button" onClick={() => setVariants(vs => vs.filter((_, j) => j !== i))} className="text-red-700 hover:text-red-800"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <input value={newVariant.name} onChange={e => setNewVariant(v => ({ ...v, name: e.target.value }))} placeholder={t('Stock.variant_name_placeholder')} className={inputCls} />
            <input value={newVariant.sku} onChange={e => setNewVariant(v => ({ ...v, sku: e.target.value }))} placeholder={t('Stock.variant_sku_placeholder')} className={inputCls} />
            <input value={newVariant.price} onChange={e => setNewVariant(v => ({ ...v, price: e.target.value }))} placeholder={t('Stock.variant_price_placeholder')} type="number" step="0.001" className={inputCls} />
            <input value={newVariant.stock} onChange={e => setNewVariant(v => ({ ...v, stock: e.target.value }))} placeholder={t('Stock.variant_stock_placeholder')} type="number" className={inputCls} />
            <input value={newVariant.size} onChange={e => setNewVariant(v => ({ ...v, size: e.target.value }))} placeholder={t('Stock.variant_size_placeholder')} className={inputCls} />
            <input value={newVariant.color} onChange={e => setNewVariant(v => ({ ...v, color: e.target.value }))} placeholder={t('Stock.variant_color_placeholder')} className={inputCls} />
          </div>
          <button type="button" onClick={addVariant} className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-sm">
            <Plus className="w-4 h-4" /> {t('Stock.add_variant')}
          </button>
        </div>

        <div className="flex items-center justify-end gap-4 pb-8">
          <Link href="/stock/products" className="px-6 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl font-bold">{t('Common.cancel')}</Link>
          <button type="submit" disabled={loading} className="flex items-center gap-2 px-8 py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold shadow-lg shadow-teal-600/20 disabled:opacity-50">
            <Save className="w-5 h-5" /> {loading ? t('Stock.creating') : t('Stock.create_product')}
          </button>
        </div>
      </form>
    </div>
  )
}
