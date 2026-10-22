'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ShoppingCart, Search, Trash2, RefreshCw, Package, Lock, ShoppingBag, Plus, Minus, CreditCard, Clock, ChevronUp, ChevronDown, FileText } from 'lucide-react'
import PaymentModal from '@/components/pos/PaymentModal'
import ReceiptModal from '@/components/pos/ReceiptModal'
import SessionOpenModal from '@/components/pos/SessionOpenModal'
import SessionCloseModal from '@/components/pos/SessionCloseModal'
import type { PaymentMethod } from '@/lib/pos-types'
import { computePosTotals, makeOrderNumber, DEFAULT_POS_SETTINGS, type PosSettings } from '@/lib/pos-logic'
import { apiFormError, fetchJson } from '@/lib/form-errors'
import { useSession } from '@/hooks/useSession'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/i18n/routing'

type PosProduct = { id: string; code: string; barcode?: string | null; name: string; salePrice: number | string; vatRate: number | string; currentStock: number | string }
type CartItem = { productId: string; productCode: string; description: string; quantity: number; unitPriceHT: number; vatRate: number; discount: number }
type PosSession = { id: string; userName: string; openingCash: number; status: string }

/** Réponse de liste tolérante : tableau brut ou { data: [...] } */
const asList = <T,>(d: unknown): T[] => (Array.isArray(d) ? d : (d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data) ? (d as { data: T[] }).data : []))

export default function POSPage() {
  const t = useTranslations('POS')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [session, setSession] = useState<PosSession | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [showSess, setShowSess] = useState(false)
  const [showClose, setShowClose] = useState(false)
  const [products, setProducts] = useState<PosProduct[]>([])
  const [productTotal, setProductTotal] = useState(0)
  const [searching, setSearching] = useState(false)
  const [cart, setCart] = useState<CartItem[]>([])
  const [q, setQ] = useState('')
  const [discount, setDiscount] = useState<number>(0)
  const [settings, setSettings] = useState<PosSettings>(DEFAULT_POS_SETTINGS)
  const [showPay, setShowPay] = useState(false)
  const [showRcpt, setShowRcpt] = useState(false)
  const [lastOrder, setLastOrder] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Panier repliable sous 640 px (mobile) : replié par défaut pour laisser la place aux produits
  const [cartOpen, setCartOpen] = useState(false)

  // Session courante = dernière session OUVERTE (jamais une session fermée)
  useEffect(() => {
    fetchJson<PosSession | null>('/api/pos/sessions?current=1').then(r => {
      if (r.ok && r.data && (r.data as PosSession).id) {
        const d = r.data as PosSession
        setSession({ id: d.id, userName: d.userName, openingCash: Number(d.openingCash), status: d.status })
      } else if (!r.ok) {
        setError(apiFormError(r.status, r.data).message)
      } else setShowSess(true)
      setSessionLoaded(true)
    })
    fetchJson<PosSettings>('/api/pos/settings').then(r => { if (r.ok && r.data) setSettings(r.data) })
  }, [])

  // Recherche produits côté serveur (débounce 250 ms) : tout le catalogue, pas seulement 200 articles
  const reqId = useRef(0)
  const loadProducts = useCallback(async (query: string) => {
    const id = ++reqId.current
    setSearching(true)
    const r = await fetchJson(`/api/pos/products?limit=${query ? 100 : 60}${query ? `&q=${encodeURIComponent(query)}` : ''}`)
    if (id !== reqId.current) return
    setSearching(false)
    if (!r.ok) { setError(apiFormError(r.status, r.data).message); return }
    const list = asList<PosProduct>(r.data)
    setProducts(list)
    const total = (r.data as { total?: number } | null)?.total
    setProductTotal(typeof total === 'number' ? total : list.length)
  }, [])

  useEffect(() => {
    if (!tenantId) return
    const h = setTimeout(() => loadProducts(q.trim()), q ? 250 : 0)
    return () => clearTimeout(h)
  }, [tenantId, q, loadProducts])

  const totals = useMemo(() => computePosTotals(cart, { discountPercent: discount, applyStamp: settings.applyStamp, stampAmount: settings.stampAmount }), [cart, discount, settings])

  const addToCart = (p: PosProduct) => {
    setCart(prev => {
      const ex = prev.find(i => i.productId === p.id)
      if (ex) return prev.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { productId: p.id, productCode: p.code, description: p.name, quantity: 1, unitPriceHT: Number(p.salePrice) || 0, vatRate: p.vatRate === null || p.vatRate === undefined || p.vatRate === '' ? 19 : Number(p.vatRate), discount: 0 }]
    })
  }

  // Lecteur code-barres : Entrée sur une correspondance exacte ajoute l'article
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    const term = q.trim()
    const exact = products.find(p => p.barcode === term || p.code === term) || (products.length === 1 ? products[0] : null)
    if (exact) { addToCart(exact); setQ('') }
  }

  const updateQty = (productId: string, delta: number) => {
    setCart(prev => prev.map(i => i.productId === productId ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i).filter(i => i.quantity > 0))
  }

  const removeFromCart = (productId: string) => { setCart(prev => prev.filter(i => i.productId !== productId)) }

  // Payload aligné sur posOrderSchema : orderNumber + payments[{ method, amount }]
  const pay = async (method: PaymentMethod, paidAmount: number) => {
    if (!session || cart.length === 0) return
    setLoading(true); setError('')
    const r = await fetchJson('/api/pos/orders', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: session.id,
        orderNumber: makeOrderNumber(),
        items: cart.map(i => ({ productId: i.productId, productCode: i.productCode, description: i.description, quantity: i.quantity, unitPriceHT: i.unitPriceHT, vatRate: i.vatRate, discount: i.discount })),
        payments: [{ method, amount: Math.round(paidAmount * 1000) / 1000 }],
        discountPercent: discount,
        notes: '',
      }),
    })
    setLoading(false)
    if (r.ok) { setLastOrder(r.data); setCart([]); setDiscount(0); setShowPay(false); setShowRcpt(true); loadProducts(q.trim()); return }
    setShowPay(false)
    setError(apiFormError(r.status, r.data, { items: 'Panier', payments: 'Paiement', sessionId: 'Session' }).message)
    if (r.status === 409) { setSession(null); setShowSess(true) }
  }

  const openSess = async (openingCash: number) => {
    setError('')
    const r = await fetchJson<PosSession>('/api/pos/sessions', { method: 'POST', body: JSON.stringify({ openingCash }) })
    if (r.ok && r.data) {
      const d = r.data
      setSession({ id: d.id, userName: d.userName, openingCash: Number(d.openingCash), status: 'OPEN' }); setShowSess(false)
    } else setError(apiFormError(r.status, r.data, { openingCash: 'Fond de caisse' }).message)
  }

  // Réglage caisse « Timbre fiscal sur les tickets » (défaut : désactivé ; modifiable par un administrateur)
  const toggleStamp = async (applyStamp: boolean) => {
    setError('')
    const r = await fetchJson<PosSettings>('/api/pos/settings', { method: 'PUT', body: JSON.stringify({ applyStamp }) })
    if (r.ok && r.data) setSettings(r.data)
    else setError(apiFormError(r.status, r.data).message)
  }

  const fmt = (n: number) => n.toLocaleString(`${locale}-TN`, { style: 'currency', currency: 'TND', minimumFractionDigits: 3 })

  const errorBanner = error ? <div role='alert' className='mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-bold flex items-start justify-between gap-3'><span>{error}</span><button onClick={() => setError('')} className='text-red-400 hover:text-red-600'>×</button></div> : null

  if (!session) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-stone-100 p-4'>
        <div className='text-center space-y-4 max-w-md'>
          {errorBanner}
          <div className='w-20 h-20 bg-stone-200 rounded-full flex items-center justify-center mx-auto'><Lock className='w-10 h-10 text-stone-400' /></div>
          <h2 className='text-2xl font-black text-stone-700'>{t('closed')}</h2>
          <p className='text-stone-500'>{t('open_hint')}</p>
          <button disabled={!sessionLoaded} onClick={() => setShowSess(true)} className='px-6 py-3 bg-teal-600 text-white rounded-xl font-bold hover:bg-teal-700 disabled:opacity-50'>{t('open_till')}</button>
        </div>
        {showSess && <SessionOpenModal onOpen={openSess} onClose={() => setShowSess(false)} />}
      </div>
    )
  }

  return (
    <div className='flex flex-col lg:flex-row gap-6 min-h-screen pb-24 sm:pb-0'>
      <div className='lg:w-2/3 space-y-4'>
        {errorBanner}
        <div className='bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden'>
          <div className='p-4 border-b border-stone-100 flex flex-col sm:flex-row gap-3'>
            <div className='relative flex-1'>
              <Search className='w-5 h-5 absolute start-3 top-1/2 -translate-y-1/2 text-stone-400' />
              <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder={t('search_product')} className='w-full ps-10 pe-4 py-2.5 border border-stone-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-500 outline-none' />
            </div>
            <button onClick={() => loadProducts(q.trim())} aria-label='Actualiser' className='px-4 py-2 border border-stone-200 rounded-xl text-stone-500 hover:bg-stone-50'><RefreshCw className={`w-4 h-4 ${searching ? 'animate-spin' : ''}`} /></button>
          </div>
          {productTotal > products.length && <p className='px-4 pt-3 text-xs text-stone-500'>{products.length} / {productTotal} articles affichés — affinez la recherche (nom, code ou code-barres).</p>}
          <div className='grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 p-4 max-h-[calc(100vh-220px)] overflow-y-auto'>
            {products.length === 0 ? (
              <div className='col-span-full text-center py-12 text-stone-400'><Package className='w-12 h-12 mx-auto mb-2' /><p className='font-medium'>{searching ? '…' : t('no_product')}</p></div>
            ) : products.map(p => (
              <button key={p.id} onClick={() => addToCart(p)} className='bg-stone-50 hover:bg-teal-50 border border-stone-200 hover:border-teal-300 rounded-xl p-3 text-start transition-all group'>
                <div className='w-full h-16 bg-stone-100 group-hover:bg-teal-100 rounded-lg mb-2 flex items-center justify-center'><Package className='w-8 h-8 text-stone-400 group-hover:text-teal-500' /></div>
                <p className='font-bold text-stone-800 text-xs truncate'>{p.name}</p>
                <p className='text-teal-600 font-black text-sm'>{fmt(Number(p.salePrice))}</p>
                <p className='text-stone-400 text-xs'>{t('in_stock', { count: Number(p.currentStock) })}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className='lg:w-1/3 space-y-4'>
        <div className='bg-white rounded-2xl border border-stone-200 shadow-sm p-4 flex items-center justify-between gap-2'>
          <div className='flex items-center gap-2 min-w-0'><Clock className='w-4 h-4 text-stone-400 shrink-0' /><span className='text-xs font-bold text-stone-500 truncate'>{session.userName}</span></div>
          <div className='flex items-center gap-3'>
            <label className='flex items-center gap-1 text-xs font-bold text-stone-400 cursor-pointer' title='Ajouter le timbre fiscal (réglage de la caisse)'>
              <input type='checkbox' checked={settings.applyStamp} onChange={e => toggleStamp(e.target.checked)} className='accent-teal-600' /> {t('stamp')}
            </label>
            <Link href={`/pos/z/${session.id}`} className='text-xs font-bold text-stone-400 hover:text-teal-600 flex items-center gap-1'><FileText className='w-3.5 h-3.5' /> Rapport X</Link>
            <button onClick={() => setShowClose(true)} className='text-xs font-bold text-stone-400 hover:text-red-500'>{t('close')}</button>
          </div>
        </div>

        {/* Barre mobile (< 640 px) : résumé du panier + bouton pour le déplier */}
        <button onClick={() => setCartOpen(o => !o)} aria-expanded={cartOpen} className='sm:hidden fixed bottom-0 inset-x-0 z-40 bg-teal-600 text-white px-4 py-3 flex items-center justify-between shadow-2xl'>
          <span className='flex items-center gap-2 font-bold'><ShoppingCart className='w-5 h-5' /> {t('cart')} ({cart.length})</span>
          <span className='flex items-center gap-2 font-black'>{fmt(totals.totalTTC)} {cartOpen ? <ChevronDown className='w-5 h-5' /> : <ChevronUp className='w-5 h-5' />}</span>
        </button>

        <div className={`${cartOpen ? 'block' : 'hidden'} sm:block space-y-4`}>
          <div className='bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col sm:max-h-[calc(100vh-420px)]'>
            <div className='p-4 border-b border-stone-100 flex items-center gap-2'>
              <ShoppingCart className='w-5 h-5 text-teal-600' />
              <span className='font-bold text-stone-800'>{t('cart')}</span>
              <span className='ms-auto bg-teal-100 text-teal-700 text-xs font-bold px-2 py-0.5 rounded-full'>{cart.length}</span>
            </div>
            <div className='flex-1 overflow-y-auto divide-y divide-stone-50'>
              {cart.length === 0 ? (
                <div className='p-8 text-center'><ShoppingBag className='w-10 h-10 text-stone-200 mx-auto mb-2' /><p className='text-stone-400 text-sm font-medium'>{t('empty_cart')}</p></div>
              ) : cart.map((item, idx) => (
                <div key={item.productId} className='p-3 flex items-center gap-3'>
                  <div className='flex-1 min-w-0'>
                    <p className='font-bold text-stone-800 text-xs truncate'>{item.description}</p>
                    <p className='text-teal-600 font-black text-sm'>{fmt(totals.lines[idx]?.totalTTC ?? 0)}</p>
                  </div>
                  <div className='flex items-center gap-1.5 bg-stone-100 rounded-lg px-2 py-1'>
                    <button onClick={() => updateQty(item.productId, -1)} className='w-6 h-6 flex items-center justify-center text-stone-500 hover:text-red-500 hover:bg-red-50 rounded transition-all'><Minus className='w-3 h-3' /></button>
                    <span className='font-bold text-stone-800 text-xs w-6 text-center'>{item.quantity}</span>
                    <button onClick={() => updateQty(item.productId, 1)} className='w-6 h-6 flex items-center justify-center text-stone-500 hover:text-teal-600 hover:bg-teal-50 rounded transition-all'><Plus className='w-3 h-3' /></button>
                  </div>
                  <button onClick={() => removeFromCart(item.productId)} className='p-1 text-stone-300 hover:text-red-400 transition-colors'><Trash2 className='w-4 h-4' /></button>
                </div>
              ))}
            </div>
          </div>

          <div className='bg-white rounded-2xl border border-stone-200 shadow-sm p-4 flex items-center gap-3'>
            <span className='text-sm font-bold text-stone-600'>{t('discount_pct')}</span>
            <input type='number' min='0' max='100' value={discount} onChange={e => setDiscount(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} className='flex-1 px-3 py-2 border border-stone-200 rounded-xl text-sm font-bold text-center focus:ring-2 focus:ring-teal-500 outline-none' />
            <span className='text-sm text-teal-600 font-bold'>-{fmt(totals.discountAmount)}</span>
          </div>

          <div className='bg-white rounded-2xl border border-stone-200 shadow-sm p-4 space-y-2'>
            {totals.discountAmount > 0 && <div className='flex justify-between text-sm'><span className='text-stone-500'>HT brut</span><span className='font-bold text-stone-700'>{fmt(totals.grossHT)}</span></div>}
            {totals.discountAmount > 0 && <div className='flex justify-between text-sm'><span className='text-teal-500'>{t('discount')}</span><span className='font-bold text-teal-600'>-{fmt(totals.discountAmount)}</span></div>}
            <div className='flex justify-between text-sm'><span className='text-stone-500'>{t('total_ht')}</span><span className='font-bold text-stone-700'>{fmt(totals.subtotalHT)}</span></div>
            <div className='flex justify-between text-sm'><span className='text-stone-500'>{t('vat')}</span><span className='font-bold text-stone-700'>{fmt(totals.totalVAT)}</span></div>
            {totals.timbreFiscal > 0 && <div className='flex justify-between text-sm'><span className='text-stone-500'>{t('stamp')}</span><span className='font-bold text-stone-700'>{fmt(totals.timbreFiscal)}</span></div>}
            <div className='border-t border-stone-200 pt-2 flex justify-between'><span className='font-black text-stone-900'>{t('total_ttc')}</span><span className='font-black text-xl text-teal-600'>{fmt(totals.totalTTC)}</span></div>
          </div>

          <button onClick={() => setShowPay(true)} disabled={cart.length === 0 || loading} className='w-full py-4 bg-teal-600 hover:bg-teal-700 disabled:bg-stone-300 text-white rounded-2xl font-black text-lg shadow-lg shadow-teal-500/20 transition-all flex items-center justify-center gap-3'>
            {loading ? <RefreshCw className='w-5 h-5 animate-spin' /> : <CreditCard className='w-5 h-5' />}
            {t('pay')} {cart.length > 0 && <span className='ms-1'>{fmt(totals.totalTTC)}</span>}
          </button>
        </div>
      </div>

      {showPay && <PaymentModal totalTTC={totals.totalTTC} onPay={pay} onClose={() => setShowPay(false)} />}
      {showRcpt && !!lastOrder && <ReceiptModal order={lastOrder} onClose={() => setShowRcpt(false)} />}
      {showClose && <SessionCloseModal sessionId={session.id} onClosed={() => { setShowClose(false); setSession(null); setCart([]) }} onClose={() => setShowClose(false)} />}
    </div>
  )
}
