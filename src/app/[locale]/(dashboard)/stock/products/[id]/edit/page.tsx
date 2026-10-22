'use client'
import { apiFormError, fetchJson } from '@/lib/form-errors'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/i18n/routing'
import { Link } from '@/i18n/routing'
import { ArrowLeft, Save, Package, Image, Hash, DollarSign, Layers, Trash2, Plus } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useTranslations } from 'next-intl'
import { useStockReferentials, CategoryInput, UnitSelect } from '@/components/stock/ProductFields'

type Variant = { id: string; name: string; sku: string; price: number; stock: number; attributes: Record<string, string> }

export default function EditProductPage() {
  const t = useTranslations('Stock.edit')
  const tm = useTranslations('StockMod')
  const refs = useStockReferentials()
  const { id } = useParams()
  const router = useRouter()
  const { tenantId } = useSession()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [suppliers, setSuppliers] = useState<any[]>([])

  const [form, setForm] = useState({
    code: '', barcode: '', name: '', description: '',
    category: '', unit: 'unit', purchasePrice: '', salePrice: '',
    vatRate: '19', fodec: false, minStock: '', supplierId: '', reorderPoint: '', reorderQty: '',
    isActive: true,
  })
  const [images, setImages] = useState<string[]>([])
  const [newImage, setNewImage] = useState('')
  const [variants, setVariants] = useState<Variant[]>([])
  const [newVariant, setNewVariant] = useState({ name: '', sku: '', price: '', stock: '', size: '', color: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    const tid = tenantId
    Promise.all([
      fetch(`/api/stock/products/${id}`).then(r => r.json()),
      fetch(`/api/commercial/suppliers`).then(r => r.ok ? r.json() : []),
    ]).then(([product, sups]) => {
      setSuppliers(sups)
      setForm({
        code: product.code || '',
        barcode: product.barcode || '',
        name: product.name || '',
        description: product.description || '',
        category: product.category || '',
        unit: product.unit || 'unit',
        purchasePrice: String(product.purchasePrice || ''),
        salePrice: String(product.salePrice || ''),
        vatRate: String(product.vatRate || '19'),
        fodec: product.fodec || false,
        minStock: String(product.minStock || ''),
        reorderPoint: String(Number(product.reorderPoint || 0) || ''),
        reorderQty: String(Number(product.reorderQty || 0) || ''),
        supplierId: product.supplierId || '',
        isActive: product.isActive !== false,
      })
      setImages(product.images || [])
      setVariants(product.variants || [])
      setLoading(false)
    })
  }, [id])

  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }))

  const addImage = () => {
    if (newImage.trim()) { setImages(im => [...im, newImage.trim()]); setNewImage('') }
  }

  const addVariant = () => {
    if (!newVariant.name || !newVariant.sku) return
    const v: Variant = { id: crypto.randomUUID(), name: newVariant.name, sku: newVariant.sku, price: Number(newVariant.price) || 0, stock: Number(newVariant.stock) || 0, attributes: { ...(newVariant.size && { Size: newVariant.size }), ...(newVariant.color && { Couleur: newVariant.color }) } }
    setVariants(vs => [...vs, v])
    setNewVariant({ name: '', sku: '', price: '', stock: '', size: '', color: '' })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code || !form.name) { setError(t('required')); return }
    setSaving(true)
    setError('')
    const r = await fetchJson(`/api/stock/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...form, images, variants }),
    })
    if (r.ok) {
      router.push(`/stock/products/${id}`)
    } else {
      // Réponse non-OK toujours affichée (y compris 500 / corps non JSON), bannière ramenée à l'écran
      setError(apiFormError(r.status, r.data).message)
      setSaving(false)
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    }
  }

  if (loading) return <div className="p-8 text-zinc-500 font-bold">{t('loading')}</div>

  const inputCls = "w-full bg-white border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 text-sm outline-none focus:border-teal-500/50"
  const labelCls = "block text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2"

  return (
    <div className="max-w-4xl mx-auto text-zinc-900">
      <div className="flex items-center gap-4 mb-8">
        <Link href={`/stock/products/${id}`} className="p-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-xl transition-all"><ArrowLeft className="w-5 h-5 rtl:rotate-180" /></Link>
        <div><h1 className="text-3xl font-black text-zinc-900 tracking-tight">{t('title')}</h1><p className="text-zinc-500 font-medium text-sm mt-1">{form.name || '...'}</p></div>
      </div>

      {error && <div role="alert" className="mb-6 px-6 py-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-700 text-sm font-bold">{error}</div>}

      <form onSubmit={handleSubmit} noValidate className="space-y-8">
        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8">
          <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-6"><Package className="w-5 h-5 text-teal-700" /> {t('info')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div><label className={labelCls}>{t('code_sku')}</label><div className="relative"><Hash className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-zinc-500" /><input value={form.code} onChange={e => set('code', e.target.value)} className={inputCls + " ps-10"} required /></div></div>
            <div><label className={labelCls}>{t('barcode')}</label><input value={form.barcode} onChange={e => set('barcode', e.target.value)} className={inputCls} /></div>
            <div className="md:col-span-2"><label className={labelCls}>{t('name')}</label><input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} required /></div>
            <div className="md:col-span-2"><label className={labelCls}>{t('description')}</label><textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className={inputCls} /></div>
            <div><label className={labelCls}>{t('category')}</label><CategoryInput value={form.category} onChange={v => set('category', v)} className={inputCls} categories={refs.categories} /></div>
            <div><label className={labelCls}>{t('unit')}</label><UnitSelect value={form.unit} onChange={v => set('unit', v)} className={inputCls} units={refs.units} /></div>
            <div><label className={labelCls}>{t('supplier')}</label><select value={form.supplierId} onChange={e => set('supplierId', e.target.value)} className={inputCls}><option value="">{t('none')}</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div className="flex items-center gap-3 pt-6"><input type="checkbox" id="isActive" checked={form.isActive} onChange={e => set('isActive', e.target.checked)} className="w-5 h-5 rounded accent-teal-500" /><label htmlFor="isActive" className="text-zinc-600 text-sm font-bold cursor-pointer">{t('active')}</label></div>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8">
          <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-6"><DollarSign className="w-5 h-5 text-emerald-700" /> {t('pricing')}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div><label className={labelCls}>{t('purchase_price')}</label><input type="number" step="0.001" value={form.purchasePrice} onChange={e => set('purchasePrice', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>{t('sale_price')}</label><input type="number" step="0.001" value={form.salePrice} onChange={e => set('salePrice', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>{t('vat')}</label><select value={form.vatRate} onChange={e => set('vatRate', e.target.value)} className={inputCls}><option value="0">0%</option><option value="7">7%</option><option value="13">13%</option><option value="19">19%</option></select></div>
            <div><label className={labelCls}>{t('min_stock')}</label><input type="number" step="any" min="0" value={form.minStock} onChange={e => set('minStock', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>{tm('reorder_point')}</label><input type="number" step="any" min="0" value={form.reorderPoint} onChange={e => set('reorderPoint', e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>{tm('reorder_qty')}</label><input type="number" step="any" min="0" value={form.reorderQty} onChange={e => set('reorderQty', e.target.value)} className={inputCls} /></div>
            <div className="flex items-center gap-3"><input type="checkbox" id="fodec" checked={form.fodec} onChange={e => set('fodec', e.target.checked)} className="w-5 h-5 rounded accent-teal-500" /><label htmlFor="fodec" className="text-zinc-600 text-sm font-bold cursor-pointer">FODEC</label></div>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8">
          <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-6"><Image className="w-5 h-5 text-purple-700" /> {t('images')}</h2>
          <div className="flex gap-3 mb-4"><input value={newImage} onChange={e => setNewImage(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addImage())} placeholder={t('image_url')} className={inputCls + " flex-1"} /><button type="button" onClick={addImage} className="px-5 py-3 bg-zinc-200 hover:bg-zinc-300 text-zinc-900 rounded-xl font-bold text-sm"><Plus className="w-4 h-4" /></button></div>
          {images.length > 0 && <div className="flex gap-3 flex-wrap">{images.map((url, i) => (<div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden bg-zinc-100"><img src={url} className="w-full h-full object-cover" alt="" /><button type="button" onClick={() => setImages(im => im.filter((_, j) => j !== i))} className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4 text-red-700" /></button></div>))}</div>}
        </div>

        <div className="bg-white border border-zinc-200 rounded-[2rem] p-8">
          <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2 mb-6"><Layers className="w-5 h-5 text-amber-700" /> {t('variants')}</h2>
          {variants.length > 0 && <div className="mb-6 space-y-2">{variants.map((v, i) => (<div key={v.id} className="flex items-center gap-4 bg-zinc-50 rounded-xl px-4 py-3"><span className="font-bold text-zinc-900 text-sm flex-1">{v.name}</span><span className="text-zinc-500 text-xs font-mono">{v.sku}</span><span className="text-emerald-700 text-sm font-mono">{Number(v.price).toFixed(3)} TND</span><button type="button" onClick={() => setVariants(vs => vs.filter((_, j) => j !== i))} className="text-red-700 hover:text-red-800"><Trash2 className="w-4 h-4" /></button></div>))}</div>}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <input value={newVariant.name} onChange={e => setNewVariant(v => ({ ...v, name: e.target.value }))} placeholder={t('variant_name')} className={inputCls} />
            <input value={newVariant.sku} onChange={e => setNewVariant(v => ({ ...v, sku: e.target.value }))} placeholder="SKU" className={inputCls} />
            <input value={newVariant.price} onChange={e => setNewVariant(v => ({ ...v, price: e.target.value }))} placeholder={t('variant_price')} type="number" step="0.001" className={inputCls} />
            <input value={newVariant.stock} onChange={e => setNewVariant(v => ({ ...v, stock: e.target.value }))} placeholder={t('variant_stock')} type="number" className={inputCls} />
            <input value={newVariant.size} onChange={e => setNewVariant(v => ({ ...v, size: e.target.value }))} placeholder={t('variant_size')} className={inputCls} />
            <input value={newVariant.color} onChange={e => setNewVariant(v => ({ ...v, color: e.target.value }))} placeholder={t('variant_color')} className={inputCls} />
          </div>
          <button type="button" onClick={addVariant} className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-sm"><Plus className="w-4 h-4" /> {t('add_variant')}</button>
        </div>

        <div className="flex items-center justify-end gap-4 pb-8">
          <Link href={`/stock/products/${id}`} className="px-6 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl font-bold">{t('cancel')}</Link>
          <button type="submit" disabled={saving} className="flex items-center gap-2 px-8 py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold shadow-lg shadow-teal-600/20 disabled:opacity-50"><Save className="w-5 h-5" />{saving ? t('saving') : t('save')}</button>
        </div>
      </form>
    </div>
  )
}
