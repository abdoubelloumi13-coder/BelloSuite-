'use client'

import { useState, useEffect, useCallback } from 'react'
import { Link } from '@/i18n/routing'
import { useTranslations, useLocale } from 'next-intl'
import { Package, Plus, Search, RefreshCw, Filter, Trash2, Edit2, Eye, AlertTriangle, X, ChevronDown, Upload, Tags, Download } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { StockNav } from '@/components/stock/ui'
import { isLowStock } from '@/lib/stock-logic'

type Product = {
  id: string
  code: string
  barcode: string | null
  name: string
  description: string | null
  category: string | null
  unit: string
  purchasePrice: string | number
  salePrice: string | number
  vatRate: string | number
  minStock: string | number
  reorderPoint?: string | number
  currentStock: string | number
  isActive: boolean
  images: string[]
  variants: ProductVariant[]
  supplierId: string | null
  createdAt: string
}

type ProductVariant = {
  id: string
  name: string
  sku: string
  price: string | number
  stock: string | number
  attributes: Record<string, string>
}

export default function ProductsListPage() {
  const t = useTranslations()
  const locale = useLocale()
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const { tenantId } = useSession()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [showCategory, setShowCategory] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<{created:number, errors:number}|null>(null)

  const handleFileUpload = async (file: File) => {
    setImportLoading(true)
    setImportResult(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`/api/stock/import`, { method: 'POST', body: formData })
      const data = await res.json()
      setImportResult(data)
      if (res.ok) { fetchProducts(tenantId); setTimeout(() => setShowImport(false), 1500) }
    } catch { setImportResult({ created: 0, errors: 1 }) }
    setImportLoading(false)
  }

  const fetchProducts = useCallback(async (tid: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/stock/products`)
      if (res.ok) setProducts(await res.json())
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [])

  useEffect(() => {
    const tid = tenantId
    fetchProducts(tid)
  }, [fetchProducts])

  const handleDelete = async (id: string) => {
    if (!confirm(t('Stock.delete_confirm_title'))) return
    const res = await fetch(`/api/stock/products/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setProducts(p => p.filter(x => x.id !== id))
      setDeleteId(null)
    }
  }

  const filtered = products.filter(p => {
    const matchSearch = !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.code.toLowerCase().includes(search.toLowerCase()) ||
      (p.barcode && p.barcode.includes(search))
    const matchCat = !categoryFilter || p.category === categoryFilter
    const stock = Number(p.currentStock)
    const matchStock = stockFilter === 'all' || (stockFilter === 'low' && stock > 0 && isLowStock(stock, Number(p.minStock), Number(p.reorderPoint ?? 0))) || (stockFilter === 'out' && stock <= 0) || (!stockFilter)
    return matchSearch && matchCat && matchStock
  })

  const cats = [...new Set(products.map(p => p.category).filter(Boolean))] as string[]
  const outStockCount = products.filter(p => Number(p.currentStock) <= 0).length
  const lowStockCount = products.filter(p => { const s = Number(p.currentStock); return s > 0 && isLowStock(s, Number(p.minStock), Number(p.reorderPoint ?? 0)) }).length

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-zinc-900 font-sans">
      <div className="flex items-center justify-between">
        <div className="text-start">
          <h1 className="text-3xl font-black text-zinc-900 tracking-tight">{t('Stock.products_list_title')}</h1>
          <p className="text-zinc-500 font-medium text-sm mt-1">
            {products.length} {t('Stock.references')} — {outStockCount} {t('Stock.ruptures')}, {lowStockCount} {t('Stock.low_stock')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => fetchProducts(tenantId)} className="p-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-xl transition-all">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-purple-600/20 transition-all">
            <Upload className="w-5 h-5" /> {t('Stock.import_csv')}
          </button>
          <Link href="/stock/settings" className="flex items-center gap-2 px-4 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-amber-600/20 transition-all">
            <Tags className="w-5 h-5" /> {t('Stock.categories')}
          </Link>
          <Link href="/stock/products/new" className="flex items-center gap-2 px-5 py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-sm shadow-lg shadow-teal-600/20">
            <Plus className="w-5 h-5" /> {t('Stock.new_product')}
          </Link>
        </div>
      </div>

      <StockNav />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-5 h-5 absolute inset-inline-start-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Stock.search_placeholder')} className="w-full bg-white border border-zinc-200 rounded-xl ps-10 pe-4 py-3 text-zinc-900 text-sm outline-none focus:border-teal-500/50" />
        </div>
        <button onClick={() => setShowFilters(!showFilters)} className="flex items-center gap-2 px-4 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-sm font-bold">
          <Filter className="w-4 h-4" /> {t('Stock.filters')} {showFilters ? <ChevronDown className="w-4 h-4 rotate-180" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {cats.length > 0 && (
          <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="bg-white border border-zinc-200 text-zinc-600 rounded-xl px-3 py-3 text-sm outline-none">
            <option value="">{t('Stock.all_categories')}</option>
            {cats.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value)} className="bg-white border border-zinc-200 text-zinc-600 rounded-xl px-3 py-3 text-sm outline-none">
          <option value="">{t('Stock.all_stocks')}</option>
          <option value="all">{t('Stock.with_stock')}</option>
          <option value="low">{t('Stock.low_stock')}</option>
          <option value="out">{t('Stock.out_of_stock')}</option>
        </select>
      </div>

      <div className="bg-white border border-zinc-200 rounded-[2rem] overflow-hidden">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <table className="w-full text-start border-collapse">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50">
              <th className="px-6 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-start">{t('Stock.product')}</th>
              <th className="px-4 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-start">{t('Stock.category')}</th>
              <th className="px-4 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('Stock.purchase_price')}</th>
              <th className="px-4 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('Stock.sale_price')}</th>
              <th className="px-4 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-center">{t('Stock.current_stock')}</th>
              <th className="px-4 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-center">{t('Stock.statut')}</th>
              <th className="px-4 py-4 text-[10px] font-black text-zinc-500 uppercase tracking-widest text-end">{t('Stock.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {loading ? (
              <tr><td colSpan={7} className="px-6 py-20 text-center text-zinc-500 text-xs font-bold uppercase tracking-widest">{t('Stock.loading')}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-6 py-20 text-center text-zinc-500 text-xs font-bold uppercase tracking-widest">{t('Stock.no_product_found')}</td></tr>
            ) : filtered.map(p => {
              const stock = Number(p.currentStock)
              const min = Number(p.minStock)
              const isOut = stock <= 0
              const isLow = stock > 0 && isLowStock(stock, min, Number(p.reorderPoint ?? 0))
              return (
                <tr key={p.id} className="hover:bg-zinc-50 group transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-100 rounded-xl flex items-center justify-center overflow-hidden">
                        {p.images && p.images[0] ? <img src={p.images[0]} className="w-full h-full object-cover" alt="" /> : <Package className="w-5 h-5 text-zinc-500" />}
                      </div>
                      <div className="text-start">
                        <p className="font-bold text-zinc-900 text-sm">{p.name}</p>
                        <p className="text-zinc-500 text-xs font-mono"><bdi dir="ltr">{p.code}</bdi>{p.barcode ? <> · <bdi dir="ltr">{p.barcode}</bdi></> : null}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-start"><span className="text-zinc-600 text-xs font-bold px-2 py-1 bg-zinc-100 rounded-lg">{p.category || '—'}</span></td>
                  <td className="px-4 py-4 text-end text-zinc-700 text-sm font-mono">{Number(p.purchasePrice).toFixed(3)} TND</td>
                  <td className="px-4 py-4 text-end text-emerald-700 text-sm font-black font-mono">{Number(p.salePrice).toFixed(3)} TND</td>
                  <td className="px-4 py-4 text-center">
                    <span className={`font-black text-sm ${isOut ? 'text-red-700' : isLow ? 'text-amber-700' : 'text-zinc-700'}`}>{stock}</span>
                    {isLow && <AlertTriangle className="w-3 h-3 text-amber-700 ms-1 inline" />}
                    {isOut && <AlertTriangle className="w-3 h-3 text-red-700 ms-1 inline" />}
                  </td>
                  <td className="px-4 py-4 text-center">
                    {isOut ? <span className="text-[9px] font-black text-red-700 bg-red-500/10 px-2 py-1 rounded-full uppercase tracking-widest">{t('Stock.status_rupture')}</span> : isLow ? <span className="text-[9px] font-black text-amber-700 bg-amber-500/10 px-2 py-1 rounded-full uppercase tracking-widest">{t('Stock.status_low')}</span> : <span className="text-[9px] font-black text-emerald-700 bg-emerald-500/10 px-2 py-1 rounded-full uppercase tracking-widest">{t('Stock.status_ok')}</span>}
                  </td>
                  <td className="px-4 py-4 text-end">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/stock/products/${p.id}`} className="p-2 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900 rounded-lg transition-all"><Eye className="w-4 h-4" /></Link>
                      <Link href={`/stock/products/${p.id}/edit`} className="p-2 hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900 rounded-lg transition-all"><Edit2 className="w-4 h-4" /></Link>
                      <button onClick={() => setDeleteId(p.id)} className="p-2 hover:bg-red-500/10 text-zinc-600 hover:text-red-700 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>

      {deleteId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white border border-zinc-300 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl text-start">
            <h3 className="text-lg font-black text-zinc-900">{t('Stock.delete_confirm_title')}</h3>
            <p className="text-zinc-600 text-sm mt-2">{t('Stock.delete_confirm_desc')}</p>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setDeleteId(null)} className="flex-1 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl font-bold text-sm">{t('Stock.cancel')}</button>
              <button onClick={() => handleDelete(deleteId)} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-sm">{t('Stock.delete')}</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-zinc-300 rounded-2xl p-8 w-full max-w-lg shadow-2xl text-start">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-black text-zinc-900 flex items-center gap-2"><Upload className="w-5 h-5 text-purple-700" /> {t('Stock.import_title')}</h3>
              <button onClick={() => setShowImport(false)} className="p-2 hover:bg-zinc-100 text-zinc-600 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-zinc-600 text-xs mb-4">{t('Stock.import_desc')}</p>
            <div className="border-2 border-dashed border-zinc-300 rounded-2xl p-8 text-center hover:border-purple-500/50 transition-all cursor-pointer"
              onClick={() => document.getElementById('csvFileInput')?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const file = e.dataTransfer.files[0]
                if (file) handleFileUpload(file)
              }}>
              <Upload className="w-10 h-10 text-zinc-500 mx-auto mb-3" />
              <p className="text-zinc-900 font-bold text-sm">{t('Stock.drop_here')}</p>
              <p className="text-zinc-500 text-xs mt-1">{t('Stock.click_to_browse')}</p>
              <p className="text-zinc-500 text-[10px] mt-2">CSV, XLSX, XLS — {t('Stock.max_size')}</p>
            </div>
            <input id="csvFileInput" type="file" accept=".csv,.xlsx,.xls" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }} />
            {importLoading && <p className="text-purple-700 text-xs text-center mt-4 animate-pulse">{t('Stock.import_in_progress')}</p>}
            {importResult && (
              <div className={`mt-4 p-4 rounded-xl text-xs font-bold ${importResult.errors === 0 ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}`}>
                {t('Stock.import_success', { created: importResult.created, errors: importResult.errors })}
              </div>
            )}
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowImport(false)} className="flex-1 py-3 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl font-bold text-sm">{t('Stock.close')}</button>
              <a href="/stock/import" className="flex-1 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold text-sm text-center flex items-center justify-center gap-2"><Download className="w-4 h-4" /> {t('Stock.download_template')}</a>
            </div>
          </div>
        </div>
      )}

      {showCategory && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShowCategory(false)}>
          <div className="bg-white border border-zinc-200 rounded-3xl p-8 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-black text-zinc-900">{t('Stock.manage_categories')}</h2>
              <button onClick={() => setShowCategory(false)} className="p-2 hover:bg-zinc-100 rounded-xl text-zinc-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex gap-3 mb-6">
              <input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder={t('Stock.new_category')} className="grow bg-zinc-100 border border-zinc-300 rounded-xl px-4 py-3 text-zinc-900 outline-none focus:border-teal-500" onKeyDown={e => { if (e.key === 'Enter') { const cat = newCategory.trim(); if (cat) { setCategories(prev => [...prev.filter(x => x !== cat), cat]); setNewCategory('') } } }} />
              <button onClick={() => { const cat = newCategory.trim(); if (cat) { setCategories(prev => [...prev.filter(x => x !== cat), cat]); setNewCategory('') } }} className="px-6 py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold">{t('Stock.add')}</button>
            </div>
            <div className="flex flex-wrap gap-2 text-start">
              {cats.map(cat => <span key={cat} className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 text-zinc-700 rounded-full text-sm"><Tags className="w-3 h-3 text-amber-700" /> {cat}</span>)}
              {cats.length === 0 && <p className="text-zinc-500 text-sm">{t('Stock.no_category')}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
