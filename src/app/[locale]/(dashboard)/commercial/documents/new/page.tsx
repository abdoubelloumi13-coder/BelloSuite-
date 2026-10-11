'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { Plus, Trash2, Save, ArrowLeft, Search, User, Package, Calendar, Info, CreditCard, FileText, Warehouse, AlertTriangle, Mic, X } from 'lucide-react'
import { calculateInvoiceTotals, VAT_RATES, FISCAL_STAMP } from '@/lib/fiscal'
import { Link } from '@/i18n/routing'
import { useSession } from '@/hooks/useSession'
import { findShortages, aggregateQuantities } from '@/lib/delivery-note-logic'
import DictateQuoteDialog from '@/components/commercial/DictateQuoteDialog'
import type { DictatedQuote } from '@/lib/dictate-quote'

type WarehouseOpt = { id: string; code: string; name: string; isDefault?: boolean }
type ProductOpt = { id: string; name: string; code?: string; salePrice?: unknown; vatRate?: unknown; fodec?: boolean; currentStock?: unknown; warehouseStock?: Array<{ warehouseId: string; stock: string | number }> }
const DOC_TYPES = ['INVOICE', 'QUOTE', 'ORDER', 'DELIVERY_NOTE', 'CREDIT_NOTE']
const DOC_PREFIX: Record<string, string> = { INVOICE: 'FAC', QUOTE: 'DEV', ORDER: 'BC', DELIVERY_NOTE: 'BL', CREDIT_NOTE: 'AV' }

export default function NewInvoicePage() {
  const t = useTranslations('Commercial.DocumentEditor')
  const dt = useTranslations('Commercial.DocumentTypes')
  const locale = useLocale()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const { tenantId } = useSession()
  const [clients, setClients] = useState<any[]>([])
  const [products, setProducts] = useState<ProductOpt[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseOpt[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [allowNegative, setAllowNegative] = useState(false)
  const [error, setError] = useState('')
  const [dictateOpen, setDictateOpen] = useState(false)
  
  const [invoiceData, setInvoiceData] = useState({
    clientId: '',
    type: 'INVOICE',
    number: `FAC-${Date.now().toString().slice(-6)}`,
    date: new Date().toISOString().split('T')[0],
    dueDate: '',
    currency: 'TND',
    items: [
      { productId: '', description: '', quantity: 1, unitPriceHT: 0, discount: 0, vatRate: 19, fodecApply: false, unit: 'EA' }
    ],
    notes: ''
  })

  useEffect(() => {
    fetchClients(tenantId)
    fetchProducts(tenantId)
    fetchStockContext()
    // Type pré-sélectionné depuis la liste (ex. ?type=DELIVERY_NOTE)
    const qType = new URLSearchParams(window.location.search).get('type')
    if (qType && DOC_TYPES.includes(qType)) {
      setInvoiceData(d => ({ ...d, type: qType, number: `${DOC_PREFIX[qType]}-${Date.now().toString().slice(-6)}` }))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Dépôts actifs (défaut présélectionné) et paramètre « stock négatif autorisé » du module stock
  const fetchStockContext = async () => {
    try {
      const [w, st] = await Promise.all([fetch('/api/stock/warehouses'), fetch('/api/stock/settings')])
      if (w.ok) {
        const list: WarehouseOpt[] = await w.json()
        if (Array.isArray(list)) {
          setWarehouses(list)
          const def = list.find(x => x.isDefault) ?? list[0]
          setWarehouseId(def?.id ?? '')
        }
      }
      if (st.ok) setAllowNegative(Boolean((await st.json())?.allowNegativeStock))
    } catch { /* module stock indisponible : pas de choix de dépôt */ }
  }

  const isDeliveryNote = invoiceData.type === 'DELIVERY_NOTE'

  // Stock disponible d'un produit dans le dépôt choisi (stock global s'il n'y a aucun dépôt)
  const availableIn = (productId: string) => {
    const p = products.find(x => x.id === productId)
    if (!p) return 0
    if (!warehouseId) return Number(p.currentStock ?? 0)
    return Number(p.warehouseStock?.find(w => w.warehouseId === warehouseId)?.stock ?? 0)
  }

  const requestedByProduct = useMemo(() => aggregateQuantities(invoiceData.items), [invoiceData.items])
  const shortages = useMemo(() => {
    if (!isDeliveryNote) return []
    const available: Record<string, number> = {}
    for (const pid of Object.keys(requestedByProduct)) available[pid] = availableIn(pid)
    return findShortages(invoiceData.items, available, allowNegative)
  }, [isDeliveryNote, requestedByProduct, invoiceData.items, allowNegative, products, warehouseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const productName = (id: string) => products.find(p => p.id === id)?.name || id

  const fmtQty = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-TN' : locale === 'en' ? 'en-GB' : 'fr-TN', { maximumFractionDigits: 3 })

  // Erreur serveur → message traduit (code renvoyé par l'API)
  const serverErrorMessage = (status: number, data: { code?: string; products?: string[]; error?: string } | null) => {
    switch (data?.code) {
      case 'INSUFFICIENT_STOCK': return t('errors.insufficient_stock', { products: (data.products || []).join(', ') })
      case 'WAREHOUSE_INVALID': return t('errors.warehouse_invalid')
      case 'WAREHOUSE_INACTIVE': return t('errors.warehouse_inactive')
    }
    if (status === 409 && /déjà utilisé/i.test(data?.error || '')) return t('errors.duplicate_number')
    return t('errors.generic')
  }

  const fetchClients = async (tid: string) => {
    const res = await fetch(`/api/commercial/clients`)
    const data = await res.json()
    setClients(data)
  }

  const fetchProducts = async (tid: string) => {
    const res = await fetch(`/api/stock/products`)
    const data = await res.json()
    setProducts(data)
  }

  const handleAddItem = () => {
    setInvoiceData({
      ...invoiceData,
      items: [...invoiceData.items, { productId: '', description: '', quantity: 1, unitPriceHT: 0, discount: 0, vatRate: 19, fodecApply: false, unit: 'EA' }]
    })
  }

  const handleRemoveItem = (index: number) => {
    const newItems = invoiceData.items.filter((_, i) => i !== index)
    setInvoiceData({ ...invoiceData, items: newItems })
  }

  const handleItemChange = (index: number, field: string, value: any) => {
    const newItems = [...invoiceData.items]
    newItems[index] = { ...newItems[index], [field]: value }
    
    if (field === 'productId') {
      const product = products.find(p => p.id === value)
      if (product) {
        newItems[index].description = product.name
        newItems[index].unitPriceHT = Number(product.salePrice)
        newItems[index].vatRate = Number(product.vatRate)
        newItems[index].fodecApply = Boolean(product.fodec)
      }
    }
    
    setInvoiceData({ ...invoiceData, items: newItems })
  }

  // Speech-to-Devis : lignes dictées ajoutées (prix catalogue si produit reconnu, prix dicté prioritaire), rien n'est enregistré
  const applyDictation = (q: DictatedQuote) => {
    setInvoiceData(d => {
      const added = q.lines.map(l => {
        const p = l.productId ? products.find(x => x.id === l.productId) : undefined
        const vat = l.vatRate !== null && VAT_RATES.includes(l.vatRate) ? l.vatRate : p ? Number(p.vatRate) : 19
        return {
          productId: p?.id ?? '',
          description: p ? p.name : l.description,
          quantity: l.quantity,
          unitPriceHT: l.unitPrice ?? (p ? Number(p.salePrice) : 0),
          discount: l.discount ?? 0,
          vatRate: vat,
          fodecApply: p ? Boolean(p.fodec) : false,
          unit: (l.unit || 'EA').slice(0, 8),
        }
      })
      // la ligne vide initiale est remplacée plutôt que conservée
      const kept = d.items.filter(it => it.productId || String(it.description).trim() || Number(it.unitPriceHT) > 0)
      let dueDate = d.dueDate
      if (q.validityDays && !dueDate && d.date) {
        const due = new Date(`${d.date}T00:00:00Z`)
        due.setUTCDate(due.getUTCDate() + q.validityDays)
        dueDate = due.toISOString().split('T')[0]
      }
      return {
        ...d,
        clientId: q.clientId || d.clientId,
        items: added.length ? [...kept, ...added] : d.items,
        dueDate,
        notes: q.notes ? (d.notes.trim() ? `${d.notes.trim()}\n${q.notes}` : q.notes) : d.notes,
      }
    })
  }

  const totals = calculateInvoiceTotals(invoiceData.items)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invoiceData.clientId) return alert(t('validation.select_client'))
    setError('')
    if (shortages.length) {
      setError(t('errors.insufficient_stock', { products: shortages.map(s => productName(s.productId)).join(', ') }))
      return
    }
    setLoading(true)

    try {
      const res = await fetch('/api/commercial/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...invoiceData,
          tenantId,
          ...totals,
          ...(isDeliveryNote && warehouseId ? { warehouseId } : {}),
        })
      })

      if (res.ok) {
        router.push(isDeliveryNote ? '/commercial/documents/delivery-notes' : '/commercial/documents')
      } else {
        let data = null
        try { data = await res.json() } catch { /* corps vide */ }
        setError(serverErrorMessage(res.status, data))
      }
    } catch (err) {
      console.error(err)
      setError(t('errors.generic'))
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-TN' : 'fr-TN', { 
    maximumFractionDigits: 3 
  })

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 min-h-screen pt-4 text-start">
      <div className="flex items-center gap-4 mb-4">
        <Link href="/commercial/documents" className="p-3 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl text-stone-400 hover:text-stone-900 dark:hover:text-white hover:bg-stone-50 dark:hover:bg-zinc-800 transition-all shadow-sm">
          <ArrowLeft className={`w-5 h-5 ${locale === 'ar' ? 'rotate-180' : ''}`} />
        </Link>
        <div>
          <h1 className="text-3xl font-black tracking-tight text-stone-900 dark:text-white">{t('title')}</h1>
          <p className="text-stone-500 text-[10px] font-black uppercase tracking-widest mt-1">{t('compliance')}</p>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-sm font-bold">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} className="text-red-400 hover:text-red-700" aria-label="×">×</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-8 pb-10">
        
        {/* Left: Invoice Data & Items */}
        <div className="lg:col-span-2 space-y-8">
           
           {/* Section: Header Info */}
           <div className="bg-white border border-stone-200 rounded-[2.5rem] p-8 space-y-6 shadow-sm">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                <div className="space-y-2">
                   <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest ms-1">{t('header.client')}</label>
                   <div className="relative">
                      <User className="w-4 h-4 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400" />
                      <select 
                        required
                        value={invoiceData.clientId}
                        onChange={e => setInvoiceData({...invoiceData, clientId: e.target.value})}
                        className="w-full bg-stone-50 border border-stone-200 rounded-2xl ps-12 pe-4 py-3 text-stone-900 outline-none focus:border-teal-500 transition-all appearance-none font-bold"
                      >
                        <option value="">{t('header.select_client')}</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name} ({c.matriculeFiscal || '---'})</option>)}
                      </select>
                   </div>
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest ms-1">{t('header.type')}</label>
                   <div className="relative">
                      <FileText className="w-4 h-4 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400" />
                      <select 
                        required
                        value={invoiceData.type}
                        onChange={e => {
                          const nt = e.target.value
                          const auto = /^(FAC|DEV|BC|BL|AV)-\d{6}$/.test(invoiceData.number)
                          setInvoiceData({ ...invoiceData, type: nt, number: auto ? `${DOC_PREFIX[nt] || 'DOC'}-${invoiceData.number.slice(-6)}` : invoiceData.number })
                        }}
                        className="w-full bg-stone-50 border border-stone-200 rounded-2xl ps-12 pe-4 py-3 text-stone-900 outline-none focus:border-teal-500 transition-all appearance-none uppercase font-bold"
                      >
                         {DOC_TYPES.map(ty => <option key={ty} value={ty}>{dt(ty)}</option>)}
                      </select>
                   </div>
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest ms-1">{t('header.reference')}</label>
                   <input 
                     value={invoiceData.number}
                     onChange={e => setInvoiceData({...invoiceData, number: e.target.value})}
                     className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-stone-900 outline-none focus:border-teal-500 transition-all font-mono font-bold"
                   />
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest ms-1">{t('header.date')}</label>
                   <div className="relative">
                      <Calendar className="w-4 h-4 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400" />
                      <input 
                        type="date"
                        value={invoiceData.date}
                        onChange={e => setInvoiceData({...invoiceData, date: e.target.value})}
                        className="w-full bg-stone-50 border border-stone-200 rounded-2xl ps-12 pe-4 py-3 text-stone-900 outline-none focus:border-teal-500 transition-all font-bold"
                      />
                   </div>
                </div>

                <div className="space-y-2">
                   <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest ms-1">{t('header.due_date')}</label>
                   <input 
                     type="date"
                     value={invoiceData.dueDate}
                     onChange={e => setInvoiceData({...invoiceData, dueDate: e.target.value})}
                     className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-stone-900 outline-none focus:border-teal-500 transition-all font-bold"
                   />
                </div>

                {isDeliveryNote && (
                  <div className="space-y-2 md:col-span-2">
                     <label htmlFor="bl-warehouse" className="text-[10px] font-black text-stone-500 uppercase tracking-widest ms-1">{t('warehouse.label')}</label>
                     {warehouses.length > 0 ? (
                       <div className="relative">
                          <Warehouse className="w-4 h-4 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400" />
                          <select
                            id="bl-warehouse"
                            required
                            value={warehouseId}
                            onChange={e => setWarehouseId(e.target.value)}
                            className="w-full bg-stone-50 border border-stone-200 rounded-2xl ps-12 pe-4 py-3 text-stone-900 outline-none focus:border-teal-500 transition-all appearance-none font-bold"
                          >
                            {warehouses.map(w => (
                              <option key={w.id} value={w.id}>{w.name} ({w.code}){w.isDefault ? ` — ${t('warehouse.default')}` : ''}</option>
                            ))}
                          </select>
                       </div>
                     ) : (
                       <p className="text-xs font-medium text-stone-500 ms-1">{t('warehouse.none')}</p>
                     )}
                     <p className="text-[11px] text-stone-400 ms-1">{allowNegative ? t('warehouse.negative_allowed') : t('warehouse.hint')}</p>
                  </div>
                )}

             </div>
           </div>

           {/* Section: Line Items */}
           <div className="bg-white border border-stone-200 rounded-[2.5rem] p-8 shadow-sm">
              <div className="flex items-center justify-between mb-8">
                 <h2 className="text-xl font-black flex items-center gap-2 text-stone-900">
                    <Package className="w-5 h-5 text-teal-600" /> {t('items.title')}
                 </h2>
                 <div className="flex items-center gap-2">
                 <button
                   type="button"
                   onClick={() => setDictateOpen(true)}
                   title={t('dictation.button_title')}
                   className="flex items-center gap-2 px-4 py-3 bg-stone-900 text-white rounded-xl transition-all hover:bg-stone-700 text-xs font-black uppercase tracking-widest"
                 >
                   <Mic className="w-4 h-4" /> {t('dictation.button')}
                 </button>
                 <button 
                   type="button"
                   onClick={handleAddItem}
                   className="p-3 bg-teal-50 text-teal-600 rounded-xl transition-all border border-teal-100 hover:bg-teal-100"
                 >
                   <Plus className="w-5 h-5" />
                 </button>
                 </div>
              </div>

              <div className="space-y-6">
                 {invoiceData.items.map((item, index) => (
                   <div key={index} className="p-6 bg-stone-50 border border-stone-100 rounded-3xl space-y-4 relative group">
                      <div className="grid grid-cols-12 gap-4">
                         <div className="col-span-12 md:col-span-4 space-y-1">
                            <label className="text-[9px] font-black text-stone-400 uppercase tracking-widest">{t('items.product')}</label>
                            <select 
                              value={item.productId}
                              onChange={e => handleItemChange(index, 'productId', e.target.value)}
                              className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-500 transition-all appearance-none font-bold"
                            >
                               <option value="">{t('items.select_product')}</option>
                               {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            {isDeliveryNote && item.productId && (() => {
                              const avail = availableIn(item.productId)
                              const short = !allowNegative && (requestedByProduct[item.productId] || 0) > avail
                              return (
                                <p className={`text-[11px] font-bold mt-1 ${short ? 'text-red-600' : 'text-stone-500'}`}>
                                  {short ? t('warehouse.insufficient', { qty: fmtQty(avail) }) : t('warehouse.available', { qty: fmtQty(avail) })}
                                </p>
                              )
                            })()}
                         </div>
                         <div className="col-span-12 md:col-span-8 space-y-1">
                            <label className="text-[9px] font-black text-stone-400 uppercase tracking-widest">{t('items.description')}</label>
                            <input 
                              value={item.description}
                              onChange={e => handleItemChange(index, 'description', e.target.value)}
                              className="w-full bg-white border border-stone-200 rounded-xl px-4 py-2 text-sm outline-none focus:border-teal-500 transition-all font-bold"
                              placeholder={t('items.designation')}
                            />
                         </div>
                      </div>

                      <div className="grid grid-cols-12 gap-4 items-end">
                         <div className="col-span-4 md:col-span-2 space-y-1">
                             <label className="text-[9px] font-black text-stone-400 uppercase tracking-widest">{t('items.unit')}</label>
                             <input 
                               type="text"
                               maxLength={8}
                               value={item.unit}
                               onChange={e => handleItemChange(index, 'unit', e.target.value.toUpperCase())}
                               className="w-full bg-white border border-stone-200 rounded-xl px-2 py-2 text-sm outline-none focus:border-teal-500 transition-all uppercase text-center font-bold"
                               placeholder="EA"
                             />
                         </div>
                         <div className="col-span-4 md:col-span-2 space-y-1">
                             <label className="text-[9px] font-black text-stone-400 uppercase tracking-widest">{t('items.qty')}</label>
                             <input 
                               type="number"
                               step="0.001"
                               value={item.quantity}
                               onChange={e => handleItemChange(index, 'quantity', e.target.value)}
                               className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-500 transition-all font-bold"
                             />
                         </div>
                         <div className="col-span-4 md:col-span-3 space-y-1">
                             <label className="text-[9px] font-black text-stone-400 uppercase tracking-widest">{t('items.unit_price')}</label>
                             <input 
                               type="number"
                               step="0.001"
                               value={item.unitPriceHT}
                               onChange={e => handleItemChange(index, 'unitPriceHT', e.target.value)}
                               className="w-full bg-white border border-stone-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-teal-500 transition-all font-bold"
                             />
                         </div>
                         <div className="col-span-4 md:col-span-2 space-y-1">
                             <label className="text-[9px] font-black text-stone-400 uppercase tracking-widest">{t('items.tva')}</label>
                             <select 
                               value={item.vatRate}
                               onChange={e => handleItemChange(index, 'vatRate', e.target.value)}
                               className="w-full bg-white border border-stone-200 rounded-xl px-2 py-2 text-sm outline-none focus:border-teal-500 transition-all appearance-none font-bold"
                             >
                                {VAT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                             </select>
                         </div>
                         <div className="col-span-6 md:col-span-2 flex items-center gap-3 pt-4 mb-2">
                             <input 
                               type="checkbox"
                               checked={item.fodecApply}
                               onChange={e => handleItemChange(index, 'fodecApply', e.target.checked)}
                               className="w-4 h-4 rounded border-stone-300 bg-white text-teal-600 focus:ring-teal-500/20 transition-all cursor-pointer"
                             />
                             <label className="text-[9px] font-black text-stone-500 uppercase tracking-widest cursor-pointer">{t('items.fodec')}</label>
                         </div>
                         <div className="col-span-2 md:col-span-1 pb-1">
                             <button 
                               type="button" 
                               onClick={() => handleRemoveItem(index)}
                               className="p-2 text-stone-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                             >
                               <Trash2 className="w-5 h-5" />
                             </button>
                         </div>
                      </div>
                      {Number(item.discount) > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-[11px] font-bold">
                          {t('dictation.discount_badge', { value: fmt(Number(item.discount)) })}
                          <button type="button" onClick={() => handleItemChange(index, 'discount', 0)} aria-label={t('dictation.remove_discount')} className="hover:text-amber-900">
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      )}
                   </div>
                 ))}
              </div>
           </div>

           {/* Notes */}
           <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-sm text-start">
              <label className="text-[10px] font-black text-stone-500 uppercase tracking-widest ms-1 block mb-3">{t('notes.label')}</label>
              <textarea 
                rows={3}
                value={invoiceData.notes}
                onChange={e => setInvoiceData({...invoiceData, notes: e.target.value})}
                className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-6 py-4 text-sm outline-none focus:border-teal-500 transition-all font-medium text-stone-900 dark:text-white"
                placeholder={t('notes.placeholder')}
              />
           </div>

        </div>

        {/* Right: Totals Sidebar */}
        <div className="space-y-8">
           <div className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-sm sticky top-8 text-start">
              <h2 className="text-xl font-black mb-8 flex items-center gap-2 text-stone-900 dark:text-white">
                 <CreditCard className="w-5 h-5 text-teal-600" /> {t('summary.title')}
              </h2>
              
              <div className="space-y-6">
                 <div className="flex items-center justify-between">
                    <span className="text-stone-400 text-[10px] font-black uppercase tracking-widest">{t('summary.subtotal_ht')}</span>
                    <span className="text-stone-900 dark:text-white font-mono text-lg font-bold">{fmt(totals.subtotalHT)} <span className="text-[10px] text-stone-400">{t('summary.currency')}</span></span>
                 </div>
                 <div className="flex items-center justify-between">
                    <span className="text-stone-400 text-[10px] font-black uppercase tracking-widest">{t('summary.fodec')}</span>
                    <span className="text-amber-600 dark:text-amber-500 font-mono text-sm font-bold">{fmt(totals.totalFodec)} <span className="text-[10px] text-stone-400">{t('summary.currency')}</span></span>
                 </div>
                 <div className="flex items-center justify-between">
                    <span className="text-stone-400 text-[10px] font-black uppercase tracking-widest">{t('summary.tva')}</span>
                    <span className="text-stone-600 dark:text-zinc-400 font-mono text-sm font-bold">{fmt(totals.totalVAT)} <span className="text-[10px] text-stone-400">{t('summary.currency')}</span></span>
                 </div>
                 <div className="flex items-center justify-between border-t border-stone-100 dark:border-zinc-800 pt-4">
                    <span className="text-stone-400 text-[10px] font-black uppercase tracking-widest">{t('summary.timbre')}</span>
                    <span className="text-stone-400 font-mono text-sm font-bold">{fmt(totals.timbreFiscal)} <span className="text-[10px] text-stone-400">{t('summary.currency')}</span></span>
                 </div>
                 
                 <div className="p-6 bg-teal-50 dark:bg-teal-500/10 border border-teal-100 dark:border-teal-500/20 rounded-3xl mt-4 space-y-1">
                    <span className="text-teal-600 dark:text-teal-400 text-[10px] font-black uppercase tracking-widest">{t('summary.total_ttc')}</span>
                    <p className="text-3xl font-black text-teal-900 dark:text-teal-400 tracking-tight">{fmt(totals.totalTTC)} <span className="text-xs font-bold opacity-60">{t('summary.currency')}</span></p>
                 </div>

                 {/* VAT Summary for TEIF */}
                 <div className="space-y-2 mt-4">
                    <p className="text-[9px] font-black text-stone-400 uppercase tracking-widest flex items-center gap-2"><Info className="w-3 h-3" /> {t('summary.taxes_detail')}</p>
                    {Object.entries(totals.vatSummary).map(([rate, data]: any) => (
                       <div key={rate} className="flex items-center justify-between text-[11px] font-bold text-stone-500 dark:text-zinc-400">
                          <span>{t('summary.vat_base', { rate })}: {fmt(data.base)}</span>
                          <span className="text-stone-400">{fmt(data.amount)}</span>
                       </div>
                    ))}
                 </div>

                 <button 
                   type="submit"
                   disabled={loading}
                   className="w-full py-5 bg-teal-600 hover:bg-teal-500 text-white rounded-[2rem] transition-all shadow-lg shadow-teal-600/20 font-black uppercase tracking-widest text-sm flex items-center justify-center gap-3 mt-4 disabled:opacity-50"
                 >
                   <Save className="w-5 h-5" />
                   {loading ? t('loading') : t('save')}
                 </button>
              </div>
           </div>
        </div>

      </form>

      {dictateOpen && (
        <DictateQuoteDialog
          onClose={() => setDictateOpen(false)}
          onApply={applyDictation}
          products={products}
          clients={clients}
        />
      )}
    </div>
  )
}
