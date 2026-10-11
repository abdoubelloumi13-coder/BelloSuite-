'use client'

/**
 * Achats fournisseurs : commandes, réceptions (seules à faire entrer du stock), factures (commerciales), retours.
 * Thème clair partagé avec le module stock (src/components/stock/ui.tsx), classes logiques pour le RTL.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/routing'
import { Plus, Trash2, CheckCircle2, XCircle, PackageCheck, Undo2, FileText, Printer, Banknote, Pencil, Lock, Save } from 'lucide-react'
import { StockPage, PageHeader, Card, Loading, EmptyState, Badge, Alert, Modal, Field, KpiCard, cls, useStockFormat, api } from '@/components/stock/ui'
import { InvoiceImportPanel } from '@/components/purchases/InvoiceImport'
import { round3, type InvoiceExtraction } from '@/lib/invoice-extract'
import { mapExtractionToDraft } from '@/lib/scan-document'
import { SCAN_QUERY_PARAM, takeScanHandoff } from '@/lib/scan-handoff'

// ─── Types ──────────────────────────────────────────────────

type Ref = { id: string; name: string; code?: string; matriculeFiscal?: string | null }
type Product = { id: string; code: string; name: string; unit: string; purchasePrice: string | number; averageCost?: string | number }
type Warehouse = { id: string; code: string; name: string; isDefault?: boolean; isActive?: boolean }
type DocRow = {
  id: string; number: string; type: string; status: string; date: string; expectedDate: string | null
  subtotal: string; total: string; supplier: Ref | null; warehouse: Ref | null; linkedOrder: { id: string; number: string } | null
  _count?: { receipts: number }
}
type Line = { id: string; productId: string | null; product: { code: string; name: string; unit: string } | null; description: string; quantity: number; unitPrice: number; total: number; received: number; returned: number; remaining: number; hasReceipts?: boolean }
type DocDetail = DocRow & {
  supplierRef: string | null; notes: string | null; taxAmount: string; taxRate?: string
  lines: Line[]
  editMode?: 'full' | 'received' | 'locked'; lockReason?: string | null
  receipts: Array<{ id: string; number: string; status: string; date: string; total: string; warehouse: Ref }>
  linkedInvoices: Array<{ id: string; number: string; status: string; subtotal: string; total: string; date: string }>
  summary: { ordered: number; received: number; invoiced: number; toInvoice: number; overInvoiced: number; status: string } | null
}
type ReceiptRow = { id: string; number: string; status: string; date: string; total: string; supplierRef: string | null; supplier: Ref | null; warehouse: Ref; purchaseOrder: { id: string; number: string } | null; _count: { items: number; returns: number } }
type ReceiptDetail = Omit<ReceiptRow, '_count'> & {
  notes: string | null
  items: Array<{ id: string; quantity: string; unitCost: string; description: string | null; product: { code: string; name: string; unit: string }; returned: number; returnable: number }>
  returns: Array<{ id: string; number: string; date: string; total: string }>
}
type ReturnRow = { id: string; number: string; date: string; total: string; notes: string | null; supplier: Ref | null; warehouse: Ref; receipt: { id: string; number: string }; items: Array<{ id: string; quantity: string; product: { code: string; name: string; unit: string } }> }

// ─── Badges & navigation ────────────────────────────────────

const TONE: Record<string, string> = {
  DRAFT: 'zinc', CONFIRMED: 'blue', PENDING: 'blue', PARTIALLY_RECEIVED: 'amber', RECEIVED: 'green',
  VALIDATED: 'green', PAID: 'teal', CANCELLED: 'red',
  NOT_INVOICED: 'zinc', PARTIALLY_INVOICED: 'amber', INVOICED: 'green', OVER_INVOICED: 'red',
}
export function PurchaseStatus({ status }: { status: string }) {
  const t = useTranslations('Purchases')
  const s = status === 'PENDING' ? 'CONFIRMED' : status
  return <Badge tone={TONE[s] ?? 'zinc'}>{t(`status_${s}` as 'status_DRAFT')}</Badge>
}

const NAV = [
  { href: '/commercial/documents/supplier-orders', key: 'nav_orders' },
  { href: '/commercial/documents/supplier-receipts', key: 'nav_receipts' },
  { href: '/commercial/documents/supplier-invoices', key: 'nav_invoices' },
  { href: '/commercial/documents/supplier-returns', key: 'nav_returns' },
] as const

export function PurchaseNav() {
  const t = useTranslations('Purchases')
  const pathname = usePathname()
  return (
    <nav className="no-print -mx-1 mb-6 overflow-x-auto" aria-label={t('module')}>
      <div className="flex gap-1 px-1 min-w-max border-b border-zinc-200">
        {NAV.map(n => {
          const active = pathname === n.href || pathname.startsWith(n.href + '/')
          return (
            <Link key={n.href} href={n.href} className={`px-3 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap ${active ? 'border-teal-600 text-teal-700' : 'border-transparent text-zinc-500 hover:text-zinc-900 hover:border-zinc-300'}`}>
              {t(n.key)}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

// ─── Référentiels ───────────────────────────────────────────

function useRefs() {
  const [suppliers, setSuppliers] = useState<Ref[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    Promise.all([
      api<Ref[]>('/api/commercial/suppliers?activeOnly=true').then(r => r.ok && Array.isArray(r.data) && setSuppliers(r.data)),
      api<Warehouse[]>('/api/stock/warehouses').then(r => r.ok && Array.isArray(r.data) && setWarehouses(r.data.filter(w => w.isActive !== false))),
      api<Product[]>('/api/stock/products').then(r => r.ok && Array.isArray(r.data) && setProducts(r.data)),
    ]).catch(() => {}).finally(() => setLoaded(true))
  }, [])
  const defaultWarehouse = warehouses.find(w => w.isDefault)?.id ?? warehouses[0]?.id ?? ''
  return { suppliers, setSuppliers, warehouses, products, defaultWarehouse, loaded }
}

/** Surlignage des champs à relire (confiance faible après import). */
const LOW_RING = 'ring-2 ring-amber-400 border-amber-400 bg-amber-50'

const n = (v: unknown) => (v === '' || v === null || v === undefined ? 0 : Number(v))
const docBase = (type: string) => (type === 'INVOICE' ? '/commercial/documents/supplier-invoices' : '/commercial/documents/supplier-orders')

// ─── Liste commandes / factures ─────────────────────────────

export function PurchaseDocsList({ docType }: { docType: 'ORDER' | 'INVOICE' }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const [rows, setRows] = useState<DocRow[] | null>(null)
  const [status, setStatus] = useState('ALL')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  /** Document scanné (page « Scanner un document ») à pré-remplir dans le formulaire de création */
  const [scanned, setScanned] = useState<InvoiceExtraction | null>(null)
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has(SCAN_QUERY_PARAM)) return
    const x = takeScanHandoff(window.sessionStorage, docType)
    router.replace(pathname)
    if (x) { setScanned(x); setCreating(true) }
  }, [docType, pathname, router])
  const statuses = docType === 'ORDER' ? ['ALL', 'DRAFT', 'CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] : ['ALL', 'DRAFT', 'VALIDATED', 'PAID', 'CANCELLED']

  const load = useCallback(async () => {
    const r = await api<DocRow[]>(`/api/commercial/suppliers/orders?type=${docType}&status=${status}`)
    if (r.ok) setRows(r.data); else { setRows([]); setError(r.error || t('error_generic')) }
  }, [docType, status, t])
  useEffect(() => { load() }, [load])

  return (
    <StockPage>
      <PageHeader title={t(docType === 'ORDER' ? 'orders_title' : 'invoices_title')} description={t(docType === 'ORDER' ? 'orders_desc' : 'invoices_desc')}
        actions={<button onClick={() => setCreating(true)} className={cls.btnPrimary}><Plus className="w-4 h-4" /> {t(docType === 'ORDER' ? 'new_order' : 'new_invoice')}</button>} />
      <PurchaseNav />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="flex flex-wrap gap-2 mb-4">
        {statuses.map(s => (
          <button key={s} onClick={() => setStatus(s)} className={`px-3 py-1.5 rounded-full text-xs font-semibold border ${status === s ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-zinc-300 text-zinc-600 hover:bg-zinc-50'}`}>
            {s === 'ALL' ? t('all') : t(`status_${s}` as 'status_DRAFT')}
          </button>
        ))}
      </div>
      <Card bodyClassName="p-0">
        {!rows ? <Loading /> : rows.length === 0 ? <EmptyState title={t('empty')} /> : (
          <div className="overflow-x-auto">
            <table className={cls.table}>
              <thead className="bg-zinc-50"><tr>
                <th className={cls.th}>{t('number')}</th>
                <th className={cls.th}>{t('date')}</th>
                <th className={cls.th}>{t('supplier')}</th>
                <th className={cls.th}>{docType === 'ORDER' ? t('warehouse') : t('linked_order')}</th>
                <th className={cls.th}>{t('status')}</th>
                <th className={`${cls.th} text-end`}>{t('subtotal')}</th>
                <th className={`${cls.th} text-end`}>{t('total_ttc')}</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className={cls.td}><Link href={`${docBase(docType)}/${r.id}`} className="font-mono font-semibold text-teal-700 hover:underline">{r.number}</Link></td>
                    <td className={cls.td}>{f.date(r.date)}</td>
                    <td className={cls.td}>{r.supplier?.name ?? '—'}</td>
                    <td className={cls.td}>{docType === 'ORDER' ? (r.warehouse?.name ?? '—') : (r.linkedOrder ? <Link href={`/commercial/documents/supplier-orders/${r.linkedOrder.id}`} className="hover:text-teal-700">{r.linkedOrder.number}</Link> : '—')}</td>
                    <td className={cls.td}><PurchaseStatus status={r.status} /></td>
                    <td className={cls.tdNum}>{f.money(r.subtotal)}</td>
                    <td className={`${cls.tdNum} font-semibold`}>{f.money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {docType === 'INVOICE' && <p className="mt-3 text-xs text-zinc-500 text-start">{t('invoice_rule')}</p>}
      <NewDocModal open={creating} docType={docType} initialExtraction={scanned} onClose={() => { setCreating(false); setScanned(null) }} />
    </StockPage>
  )
}

// ─── Création commande / facture ────────────────────────────

/** `id` = ligne existante ; `minQty` = déjà reçu (net) ; `fixed` = ligne réceptionnée (ni suppression ni changement d'article). */
type EditLine = { id?: string; productId: string; description: string; quantity: string; unitPrice: string; minQty?: number; fixed?: boolean; low?: boolean }

function LinesEditor({ lines, setLines, products, priceLabel, allowFreeText = false }: { lines: EditLine[]; setLines: (l: EditLine[]) => void; products: Product[]; priceLabel: string; allowFreeText?: boolean }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const upd = (i: number, patch: Partial<EditLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch, low: false } : l)))
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className={cls.table}>
          <thead><tr>
            <th className={cls.th}>{t('product')}</th>
            <th className={`${cls.th} text-end w-28`}>{t('quantity')}</th>
            <th className={`${cls.th} text-end w-32`}>{priceLabel}</th>
            <th className={`${cls.th} text-end w-32`}>{t('amount')}</th>
            <th className="w-10" />
          </tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className={l.low ? 'bg-amber-50' : undefined}>
                <td className="px-2 py-1.5">
                  <select className={`${cls.input} ${l.low ? LOW_RING : ''}`} value={l.productId} disabled={l.fixed} onChange={e => {
                    const p = products.find(x => x.id === e.target.value)
                    upd(i, { productId: e.target.value, description: p ? `${p.code} — ${p.name}` : '', unitPrice: p ? String(n(p.purchasePrice) || n(p.averageCost)) : l.unitPrice })
                  }}>
                    <option value="">{t('choose_product')}</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                    {l.productId && !products.some(p => p.id === l.productId) && <option value={l.productId}>{l.description}</option>}
                  </select>
                  {allowFreeText && !l.productId && (
                    <input className={`${cls.input} mt-1 ${l.low ? LOW_RING : ''}`} placeholder={t('free_text_line')} aria-label={t('free_text_line')} value={l.description} onChange={e => upd(i, { description: e.target.value })} />
                  )}
                </td>
                <td className="px-2 py-1.5">
                  <input type="number" min={l.minQty ?? 0} step="any" className={`${cls.input} text-end ${l.minQty && n(l.quantity) < l.minQty ? 'border-red-500' : ''}`} value={l.quantity} onChange={e => upd(i, { quantity: e.target.value })} />
                  {!!l.minQty && <div className="mt-0.5 text-[11px] text-zinc-500 text-end">{t('min_received', { min: l.minQty })}</div>}
                </td>
                <td className="px-2 py-1.5"><input type="number" min="0" step="any" className={`${cls.input} text-end ${l.low ? LOW_RING : ''}`} value={l.unitPrice} onChange={e => upd(i, { unitPrice: e.target.value })} /></td>
                <td className={cls.tdNum}>{f.money(n(l.quantity) * n(l.unitPrice))}</td>
                <td className="px-1">{l.fixed
                  ? <span className="inline-flex p-2 text-zinc-400" title={t('line_received_locked')} aria-label={t('line_received_locked')}><Lock className="w-4 h-4" /></span>
                  : <button type="button" className={cls.btnGhost} onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={t('remove_line')}><Trash2 className="w-4 h-4" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className={cls.btnSecondary} onClick={() => setLines([...lines, { productId: '', description: '', quantity: '1', unitPrice: '0' }])}><Plus className="w-4 h-4" /> {t('add_line')}</button>
    </div>
  )
}

function NewDocModal({ open, docType, onClose, initialExtraction = null }: { open: boolean; docType: 'ORDER' | 'INVOICE'; onClose: () => void; initialExtraction?: InvoiceExtraction | null }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const router = useRouter()
  const { suppliers, setSuppliers, warehouses, products, defaultWarehouse, loaded } = useRefs()
  const isInvoice = docType === 'INVOICE'
  const [supplierId, setSupplierId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [supplierRef, setSupplierRef] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [vat, setVat] = useState('19')
  /** Montant de TVA saisi / importé (plusieurs taux) ; vide = calculé depuis le taux. */
  const [vatAmount, setVatAmount] = useState('')
  const [fodec, setFodec] = useState('')
  const [stamp, setStamp] = useState('')
  const [lines, setLines] = useState<EditLine[]>([{ productId: '', description: '', quantity: '1', unitPrice: '0' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [low, setLow] = useState<Set<string>>(new Set())
  const [newSupplier, setNewSupplier] = useState<{ name: string; matriculeFiscal: string | null } | null>(null)
  const [vatBreakdown, setVatBreakdown] = useState<string>('')
  const subtotal = lines.reduce((s, l) => s + n(l.quantity) * n(l.unitPrice), 0)
  const fodecN = isInvoice ? n(fodec) : 0
  const stampN = isInvoice ? n(stamp) : 0
  const vatN = isInvoice && vatAmount !== '' ? n(vatAmount) : Math.round((subtotal + fodecN) * n(vat) * 10) / 1000
  const tax = round3(vatN + fodecN + stampN)
  const lowCls = (k: string) => (low.has(k) ? LOW_RING : '')
  const touch = (k: string) => low.has(k) && setLow(prev => { const s2 = new Set(prev); s2.delete(k); return s2 })

  function applyExtraction(x: InvoiceExtraction) {
    const d = mapExtractionToDraft(x, docType, suppliers, products, { globalLineLabel: t(isInvoice ? 'ocr_global_line' : 'ocr_global_line_order') })
    setSupplierId(d.supplierId)
    setNewSupplier(d.supplierId ? null : d.newSupplier)
    if (d.supplierRef) setSupplierRef(d.supplierRef)
    if (d.date) setInvoiceDate(d.date)
    if (isInvoice) {
      setFodec(d.fodec ? String(d.fodec) : '')
      setStamp(d.stamp ? String(d.stamp) : '')
      if (d.vatRate !== null) setVat(String(d.vatRate))
      setVatAmount(d.vatAmount !== null ? String(d.vatAmount) : '')
      setVatBreakdown(d.vatBreakdown.length ? d.vatBreakdown.map(v => `TVA ${v.rate} % : ${f.money(v.amount)}`).join(' ; ') : '')
    } else if (d.vatRate !== null) setVat(String(d.vatRate))
    if (d.lines.length) setLines(d.lines)
    setLow(new Set(d.low))
  }

  // Document transmis par la page « Scanner un document » : appliqué une fois les référentiels chargés
  const appliedScan = useRef<InvoiceExtraction | null>(null)
  useEffect(() => {
    if (!open || !initialExtraction || !loaded || appliedScan.current === initialExtraction) return
    appliedScan.current = initialExtraction
    applyExtraction(initialExtraction)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- appliquer une seule fois par extraction
  }, [open, initialExtraction, loaded])

  async function createSupplier() {
    if (!newSupplier) return
    setBusy(true); setError('')
    const r = await api<Ref>('/api/commercial/suppliers', { method: 'POST', body: JSON.stringify({ name: newSupplier.name, matriculeFiscal: newSupplier.matriculeFiscal }) })
    setBusy(false)
    if (!r.ok) { setError(r.error || t('error_generic')); return }
    setSuppliers(prev => [...prev, r.data].sort((a, b) => a.name.localeCompare(b.name)))
    setSupplierId(r.data.id); setNewSupplier(null); touch('supplier')
  }

  async function save(confirm: boolean) {
    setBusy(true); setError('')
    const notes = isInvoice && (fodecN || stampN || vatBreakdown)
      ? [vatBreakdown || `${t('vat')} : ${f.money(vatN)}`, fodecN ? `FODEC : ${f.money(fodecN)}` : '', stampN ? `${t('stamp_duty')} : ${f.money(stampN)}` : ''].filter(Boolean).join(' ; ')
      : null
    const r = await api<{ id: string }>('/api/commercial/suppliers/orders', {
      method: 'POST',
      body: JSON.stringify({
        type: docType, supplierId: supplierId || null, warehouseId: docType === 'ORDER' ? (warehouseId || defaultWarehouse || null) : null,
        expectedDate: expectedDate || null, supplierRef: supplierRef || null, taxAmount: tax,
        date: invoiceDate || null, notes,
        status: confirm ? (docType === 'ORDER' ? 'CONFIRMED' : 'VALIDATED') : 'DRAFT',
        items: lines
          .filter(l => (l.productId || l.description.trim()) && n(l.quantity) > 0)
          .map(l => ({ productId: l.productId || null, description: l.description.trim() || l.productId, quantity: n(l.quantity), unitPrice: n(l.unitPrice) })),
      }),
    })
    setBusy(false)
    if (!r.ok) { setError(r.error || t('error_generic')); return }
    router.push(`${docBase(docType)}/${r.data.id}`)
  }

  return (
    <Modal open={open} wide title={t(docType === 'ORDER' ? 'new_order' : 'new_invoice')} onClose={onClose}
      footer={<>
        <button className={cls.btnSecondary} onClick={onClose}>{t('cancel')}</button>
        <button className={cls.btnSecondary} disabled={busy || !supplierId} onClick={() => save(false)}>{t('save_draft')}</button>
        <button className={cls.btnPrimary} disabled={busy || !supplierId} onClick={() => save(true)}><CheckCircle2 className="w-4 h-4" /> {t(docType === 'ORDER' ? 'save_confirm' : 'save_validate')}</button>
      </>}>
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <InvoiceImportPanel onExtracted={applyExtraction} variant={isInvoice ? 'invoice' : 'order'} showSamples={isInvoice} />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
        <Field label={t('supplier')}>
          <select className={`${cls.input} ${lowCls('supplier')}`} value={supplierId} onChange={e => { setSupplierId(e.target.value); touch('supplier') }}>
            <option value="">{t('choose_supplier')}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {newSupplier && !supplierId && (
            <button type="button" disabled={busy} onClick={createSupplier} className="mt-1 text-xs font-semibold text-teal-700 hover:underline text-start">
              <Plus className="inline w-3.5 h-3.5" /> {t('create_supplier', { name: newSupplier.name })}
            </button>
          )}
        </Field>
        {docType === 'ORDER' ? (
          <>
            <Field label={t('delivery_warehouse')}>
              <select className={cls.input} value={warehouseId || defaultWarehouse} onChange={e => setWarehouseId(e.target.value)}>
                {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </Field>
            <Field label={t('expected_date')}><input type="date" className={cls.input} value={expectedDate} onChange={e => setExpectedDate(e.target.value)} /></Field>
            <Field label={t('supplier_doc_ref')}><input className={`${cls.input} ${lowCls('ref')}`} value={supplierRef} onChange={e => { setSupplierRef(e.target.value); touch('ref') }} /></Field>
            <Field label={t('order_date')}><input type="date" className={`${cls.input} ${lowCls('date')}`} value={invoiceDate} onChange={e => { setInvoiceDate(e.target.value); touch('date') }} /></Field>
          </>
        ) : (
          <>
            <Field label={t('supplier_invoice_ref')}><input className={`${cls.input} ${lowCls('ref')}`} value={supplierRef} onChange={e => { setSupplierRef(e.target.value); touch('ref') }} /></Field>
            <Field label={t('invoice_date')}><input type="date" className={`${cls.input} ${lowCls('date')}`} value={invoiceDate} onChange={e => { setInvoiceDate(e.target.value); touch('date') }} /></Field>
          </>
        )}
        <Field label={t('vat_rate')}><input type="number" min="0" max="100" step="any" className={`${cls.input} ${!isInvoice ? lowCls('vat') : ''}`} value={vat} onChange={e => { setVat(e.target.value); setVatAmount(''); touch('vat') }} /></Field>
      </div>
      <LinesEditor lines={lines} setLines={setLines} products={products} priceLabel={t('unit_price')} allowFreeText />
      {!isInvoice && lines.some(l => !l.productId && l.description.trim()) && <p className="mt-2 text-xs text-amber-700 text-start">{t('order_free_text_hint')}</p>}
      <div className="mt-4 flex flex-col items-end gap-1 text-sm">
        <div>{t('subtotal')} : <span className="font-semibold tabular-nums">{f.money(subtotal)}</span></div>
        {isInvoice ? (
          <>
            <label className="flex items-center gap-2">FODEC : <input type="number" min="0" step="any" className={`${cls.input} !w-32 !py-1 text-end ${lowCls('fodec')}`} value={fodec} placeholder="0" onChange={e => { setFodec(e.target.value); touch('fodec') }} /></label>
            <label className="flex items-center gap-2">{t('vat')} : <input type="number" min="0" step="any" className={`${cls.input} !w-32 !py-1 text-end ${lowCls('vat')}`} value={vatAmount === '' ? String(vatN) : vatAmount} onChange={e => { setVatAmount(e.target.value); touch('vat') }} /></label>
            {vatBreakdown && <div className="text-xs text-zinc-500">{vatBreakdown}</div>}
            <label className="flex items-center gap-2">{t('stamp_duty')} : <input type="number" min="0" step="any" className={`${cls.input} !w-32 !py-1 text-end ${lowCls('stamp')}`} value={stamp} placeholder="0" onChange={e => { setStamp(e.target.value); touch('stamp') }} /></label>
          </>
        ) : (
          <div>{t('vat')} : <span className="tabular-nums">{f.money(tax)}</span></div>
        )}
        <div className={`text-base rounded-lg px-1 ${lowCls('totals')}`}>{t('total_ttc')} : <span className="font-bold tabular-nums">{f.money(subtotal + tax)}</span></div>
        {low.has('totals') && <div className="text-xs text-amber-700">{t('ocr_check_totals')}</div>}
      </div>
    </Modal>
  )
}

// ─── Détail commande / facture ──────────────────────────────

export function PurchaseDocDetail({ id }: { id: string }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const router = useRouter()
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [receiving, setReceiving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await api<DocDetail>(`/api/commercial/suppliers/orders/${id}`)
    if (r.ok) setDoc(r.data); else setError(r.error || t('error_generic'))
  }, [id, t])
  useEffect(() => { load() }, [load])

  async function act(action: string) {
    if (action === 'cancel' && !window.confirm(t('confirm_cancel'))) return
    setBusy(true); setError('')
    const r = await api(`/api/commercial/suppliers/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
    setBusy(false)
    if (!r.ok) setError(r.error || t('error_generic')); else load()
  }
  async function remove() {
    if (!window.confirm(t('confirm_delete'))) return
    const r = await api(`/api/commercial/suppliers/orders/${id}`, { method: 'DELETE' })
    if (!r.ok) setError(r.error || t('error_generic')); else router.push(docBase(doc?.type ?? 'ORDER'))
  }
  async function invoiceReceived() {
    if (!doc) return
    const items = doc.lines.filter(l => l.productId && l.received - l.returned > 0).map(l => ({ productId: l.productId, description: l.description, quantity: l.received - l.returned, unitPrice: l.unitPrice }))
    if (!items.length) { setError(t('nothing_received')); return }
    const sub = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    const rate = n(doc.subtotal) > 0 ? n(doc.taxAmount) / n(doc.subtotal) : 0
    setBusy(true)
    const r = await api<{ id: string }>('/api/commercial/suppliers/orders', {
      method: 'POST',
      body: JSON.stringify({ type: 'INVOICE', supplierId: doc.supplier?.id ?? null, linkedOrderId: doc.id, taxAmount: Math.round(sub * rate * 1000) / 1000, items }),
    })
    setBusy(false)
    if (!r.ok) setError(r.error || t('error_generic')); else router.push(`/commercial/documents/supplier-invoices/${r.data.id}`)
  }

  if (!doc) return <StockPage>{error ? <Alert>{error}</Alert> : <Loading />}</StockPage>
  const isOrder = doc.type === 'ORDER'
  const st = doc.status
  const canReceive = isOrder && (st === 'CONFIRMED' || st === 'PARTIALLY_RECEIVED')
  const editable = !!doc.editMode && doc.editMode !== 'locked'

  return (
    <StockPage>
      <PageHeader backHref={docBase(doc.type)} title={`${t(isOrder ? 'order' : 'invoice')} ${doc.number}`}
        description={`${doc.supplier?.name ?? '—'} · ${f.date(doc.date)}`}
        actions={<>
          <button onClick={() => window.print()} className={cls.btnSecondary}><Printer className="w-4 h-4" /> {t('print')}</button>
          {editable && !editing && <button disabled={busy} onClick={() => setEditing(true)} className={cls.btnSecondary}><Pencil className="w-4 h-4" /> {t('edit')}</button>}
          {st === 'DRAFT' && <button disabled={busy} onClick={remove} className={cls.btnSecondary}><Trash2 className="w-4 h-4" /> {t('delete')}</button>}
          {isOrder && st === 'DRAFT' && <button disabled={busy} onClick={() => act('confirm')} className={cls.btnPrimary}><CheckCircle2 className="w-4 h-4" /> {t('confirm_order')}</button>}
          {!isOrder && st === 'DRAFT' && <button disabled={busy} onClick={() => act('validate')} className={cls.btnPrimary}><CheckCircle2 className="w-4 h-4" /> {t('validate_invoice')}</button>}
          {!isOrder && st === 'VALIDATED' && <button disabled={busy} onClick={() => act('pay')} className={cls.btnSecondary}><Banknote className="w-4 h-4" /> {t('mark_paid')}</button>}
          {canReceive && <button onClick={() => setReceiving(true)} className={cls.btnPrimary}><PackageCheck className="w-4 h-4" /> {t('receive')}</button>}
          {isOrder && (st === 'PARTIALLY_RECEIVED' || st === 'RECEIVED') && <button disabled={busy} onClick={invoiceReceived} className={cls.btnSecondary}><FileText className="w-4 h-4" /> {t('invoice_received')}</button>}
          {((isOrder && (st === 'DRAFT' || st === 'CONFIRMED')) || (!isOrder && (st === 'DRAFT' || st === 'VALIDATED'))) &&
            <button disabled={busy} onClick={() => act('cancel')} className={cls.btnDanger}><XCircle className="w-4 h-4" /> {t('cancel_doc')}</button>}
        </>} />
      <PurchaseNav />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {info && <Alert tone="green" onClose={() => setInfo('')}>{info}</Alert>}
      {doc.editMode === 'locked' && doc.lockReason && (
        <div className="no-print mb-4 flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 text-start">
          <Lock className="w-4 h-4 mt-0.5 shrink-0" /> <span>{t(`lock_${doc.lockReason}` as 'lock_ORDER_RECEIVED')}</span>
        </div>
      )}
      {editing && <EditDocForm doc={doc} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); setInfo(t('changes_saved')); load() }} />}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard label={t('status')} value={<PurchaseStatus status={st} />} />
        <KpiCard label={t('subtotal')} value={f.money(doc.subtotal)} />
        <KpiCard label={t('total_ttc')} value={f.money(doc.total)} tone="teal" />
        {isOrder
          ? <KpiCard label={t('delivery_warehouse')} value={doc.warehouse?.name ?? '—'} />
          : <KpiCard label={t('linked_order')} value={doc.linkedOrder ? <Link href={`/commercial/documents/supplier-orders/${doc.linkedOrder.id}`} className="text-teal-700 hover:underline">{doc.linkedOrder.number}</Link> : '—'} />}
      </div>

      <Card title={t('lines')} bodyClassName="p-0" className="mb-6">
        <div className="overflow-x-auto">
          <table className={cls.table}>
            <thead className="bg-zinc-50"><tr>
              <th className={cls.th}>{t('product')}</th>
              <th className={`${cls.th} text-end`}>{t(isOrder ? 'ordered' : 'quantity')}</th>
              {isOrder && <th className={`${cls.th} text-end`}>{t('received')}</th>}
              {isOrder && <th className={`${cls.th} text-end`}>{t('returned')}</th>}
              {isOrder && <th className={`${cls.th} text-end`}>{t('remaining')}</th>}
              <th className={`${cls.th} text-end`}>{t('unit_price')}</th>
              <th className={`${cls.th} text-end`}>{t('amount')}</th>
            </tr></thead>
            <tbody className="divide-y divide-zinc-100">
              {doc.lines.map(l => (
                <tr key={l.id}>
                  <td className={cls.td}>{l.description}</td>
                  <td className={cls.tdNum}>{f.qty(l.quantity)} <span className="text-xs text-zinc-400">{l.product?.unit}</span></td>
                  {isOrder && <td className={`${cls.tdNum} text-green-700`}>{f.qty(l.received)}</td>}
                  {isOrder && <td className={cls.tdNum}>{l.returned ? f.qty(l.returned) : '—'}</td>}
                  {isOrder && <td className={`${cls.tdNum} ${l.remaining > 0 ? 'text-amber-700 font-semibold' : 'text-zinc-400'}`}>{f.qty(l.remaining)}</td>}
                  <td className={cls.tdNum}>{f.money(l.unitPrice)}</td>
                  <td className={cls.tdNum}>{f.money(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {isOrder && doc.summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title={t('receipts')} bodyClassName="p-0">
            {doc.receipts.length === 0 ? <EmptyState title={t('no_receipt')} /> : (
              <table className={cls.table}><tbody className="divide-y divide-zinc-100">
                {doc.receipts.map(r => (
                  <tr key={r.id}>
                    <td className={cls.td}><Link href={`/commercial/documents/supplier-receipts?open=${r.id}`} className="font-mono text-teal-700 hover:underline">{r.number}</Link></td>
                    <td className={cls.td}>{f.date(r.date)}</td>
                    <td className={cls.td}>{r.warehouse.name}</td>
                    <td className={cls.td}><PurchaseStatus status={r.status} /></td>
                    <td className={cls.tdNum}>{f.money(r.total)}</td>
                  </tr>
                ))}
              </tbody></table>
            )}
          </Card>
          <Card title={t('invoicing')}>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-zinc-500 text-start">{t('ordered_amount')}</dt><dd className="text-end tabular-nums">{f.money(doc.summary.ordered)}</dd>
              <dt className="text-zinc-500 text-start">{t('received_amount')}</dt><dd className="text-end tabular-nums text-green-700 font-semibold">{f.money(doc.summary.received)}</dd>
              <dt className="text-zinc-500 text-start">{t('invoiced_amount')}</dt><dd className="text-end tabular-nums">{f.money(doc.summary.invoiced)}</dd>
              <dt className="text-zinc-500 text-start">{t('to_invoice')}</dt><dd className="text-end tabular-nums font-semibold">{f.money(doc.summary.toInvoice)}</dd>
              <dt className="text-zinc-500 text-start">{t('status')}</dt><dd className="text-end"><PurchaseStatus status={doc.summary.status} /></dd>
            </dl>
            {doc.linkedInvoices.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {doc.linkedInvoices.map(i => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <Link href={`/commercial/documents/supplier-invoices/${i.id}`} className="font-mono text-teal-700 hover:underline">{i.number}</Link>
                    <span className="flex items-center gap-2"><PurchaseStatus status={i.status} /><span className="tabular-nums">{f.money(i.subtotal)}</span></span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-zinc-500 text-start">{t('invoice_rule')}</p>
          </Card>
        </div>
      )}
      {!isOrder && <p className="text-xs text-zinc-500 text-start">{t('invoice_rule')}</p>}

      {receiving && <ReceiveModal doc={doc} onClose={() => setReceiving(false)} onDone={(num) => { setReceiving(false); setInfo(t('receipt_done', { number: num })); load() }} />}
    </StockPage>
  )
}

// ─── Modification commande / facture ───────────────────────

function EditDocForm({ doc, onCancel, onSaved }: { doc: DocDetail; onCancel: () => void; onSaved: () => void }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const { suppliers, warehouses, products } = useRefs()
  const isOrder = doc.type === 'ORDER'
  const constrained = doc.editMode === 'received'
  const day = (d: string | null) => (d ? d.slice(0, 10) : '')
  const initialVat = n(doc.subtotal) > 0 ? Math.round(n(doc.taxAmount) / n(doc.subtotal) * 100000) / 1000 : n(doc.taxRate)
  const [supplierId, setSupplierId] = useState(doc.supplier?.id ?? '')
  const [warehouseId, setWarehouseId] = useState(doc.warehouse?.id ?? '')
  const [date, setDate] = useState(day(doc.date))
  const [expectedDate, setExpectedDate] = useState(day(doc.expectedDate))
  const [supplierRef, setSupplierRef] = useState(doc.supplierRef ?? '')
  const [notes, setNotes] = useState(doc.notes ?? '')
  const [vat, setVat] = useState(String(initialVat))
  const [lines, setLines] = useState<EditLine[]>(() => doc.lines.map(l => {
    const net = Math.max(0, Math.round((l.received - l.returned) * 1000) / 1000)
    return {
      id: l.id, productId: l.productId ?? '', description: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice),
      minQty: isOrder && net > 0 ? net : undefined, fixed: isOrder && !!l.hasReceipts,
    }
  }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const valid = lines.filter(l => (l.productId || l.description) && n(l.quantity) > 0)
  const belowMin = lines.some(l => l.minQty && n(l.quantity) < l.minQty)
  const subtotal = valid.reduce((s, l) => s + n(l.quantity) * n(l.unitPrice), 0)
  const tax = Math.round(subtotal * n(vat) * 10) / 1000

  async function save() {
    setBusy(true); setError('')
    const r = await api(`/api/commercial/suppliers/orders/${doc.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        action: 'update', supplierId: supplierId || null, warehouseId: isOrder ? (warehouseId || null) : null,
        date: date || null, expectedDate: isOrder ? (expectedDate || null) : null, supplierRef: supplierRef || null, notes: notes || null,
        vatRate: n(vat),
        items: valid.map(l => ({ id: l.id ?? null, productId: l.productId || null, description: l.description, quantity: n(l.quantity), unitPrice: n(l.unitPrice) })),
      }),
    })
    setBusy(false)
    if (!r.ok) setError(r.error || t('error_generic')); else onSaved()
  }

  return (
    <Card title={t(isOrder ? 'edit_order' : 'edit_invoice')} className="no-print mb-6">
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {constrained && <Alert tone="amber">{t('edit_received_hint')}</Alert>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Field label={t('supplier')}>
          <select className={cls.input} value={supplierId} disabled={constrained} title={constrained ? t('supplier_locked_received') : undefined} onChange={e => setSupplierId(e.target.value)}>
            <option value="">{t('choose_supplier')}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            {doc.supplier && !suppliers.some(s => s.id === doc.supplier?.id) && <option value={doc.supplier.id}>{doc.supplier.name}</option>}
          </select>
        </Field>
        {isOrder && (
          <Field label={t('delivery_warehouse')}>
            <select className={cls.input} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
              <option value="">—</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              {doc.warehouse && !warehouses.some(w => w.id === doc.warehouse?.id) && <option value={doc.warehouse.id}>{doc.warehouse.name}</option>}
            </select>
          </Field>
        )}
        <Field label={t('doc_date')}><input type="date" className={cls.input} value={date} onChange={e => setDate(e.target.value)} /></Field>
        {isOrder && <Field label={t('expected_date')}><input type="date" className={cls.input} value={expectedDate} onChange={e => setExpectedDate(e.target.value)} /></Field>}
        <Field label={t(isOrder ? 'supplier_ref' : 'supplier_invoice_ref')}><input className={cls.input} value={supplierRef} onChange={e => setSupplierRef(e.target.value)} /></Field>
        <Field label={t('vat_rate')}><input type="number" min="0" max="100" step="any" className={cls.input} value={vat} onChange={e => setVat(e.target.value)} /></Field>
      </div>
      <LinesEditor lines={lines} setLines={setLines} products={products} priceLabel={t('unit_price')} allowFreeText={!isOrder} />
      <div className="mt-3"><Field label={t('notes')}><textarea rows={2} className={cls.input} value={notes} onChange={e => setNotes(e.target.value)} /></Field></div>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div className="flex gap-2">
          <button className={cls.btnSecondary} disabled={busy} onClick={onCancel}>{t('cancel')}</button>
          <button className={cls.btnPrimary} disabled={busy || !valid.length || belowMin || (isOrder && !supplierId)} onClick={save}><Save className="w-4 h-4" /> {t('save_changes')}</button>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <div>{t('subtotal')} : <span className="font-semibold tabular-nums">{f.money(subtotal)}</span></div>
          <div>{t('vat')} : <span className="tabular-nums">{f.money(tax)}</span></div>
          <div className="text-base">{t('total_ttc')} : <span className="font-bold tabular-nums">{f.money(subtotal + tax)}</span></div>
        </div>
      </div>
    </Card>
  )
}

// ─── Réception d'une commande ───────────────────────────────

function ReceiveModal({ doc, onClose, onDone }: { doc: DocDetail; onClose: () => void; onDone: (number: string) => void }) {
  const t = useTranslations('Purchases')
  const { warehouses, defaultWarehouse } = useRefs()
  const [warehouseId, setWarehouseId] = useState(doc.warehouse?.id ?? '')
  const [supplierRef, setSupplierRef] = useState('')
  const [allowOver, setAllowOver] = useState(false)
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(doc.lines.map(l => [l.id, String(l.remaining)])))
  const [cost, setCost] = useState<Record<string, string>>(() => Object.fromEntries(doc.lines.map(l => [l.id, String(l.unitPrice)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const over = doc.lines.some(l => n(qty[l.id]) > l.remaining)

  async function submit(validate: boolean) {
    setBusy(true); setError('')
    const r = await api<{ number: string }>('/api/commercial/suppliers/receipts', {
      method: 'POST',
      body: JSON.stringify({
        purchaseOrderId: doc.id, warehouseId: warehouseId || defaultWarehouse, supplierRef: supplierRef || null, validate, allowOverReceipt: allowOver,
        items: doc.lines.filter(l => n(qty[l.id]) > 0).map(l => ({ purchaseOrderItemId: l.id, quantity: n(qty[l.id]), unitCost: n(cost[l.id]) })),
      }),
    })
    setBusy(false)
    if (!r.ok) setError(r.error || t('error_generic')); else onDone(r.data.number)
  }

  return (
    <Modal open wide title={`${t('receive')} — ${doc.number}`} onClose={onClose}
      footer={<>
        <button className={cls.btnSecondary} onClick={onClose}>{t('cancel')}</button>
        <button className={cls.btnSecondary} disabled={busy || (over && !allowOver)} onClick={() => submit(false)}>{t('save_draft')}</button>
        <button className={cls.btnPrimary} disabled={busy || (over && !allowOver)} onClick={() => submit(true)}><PackageCheck className="w-4 h-4" /> {t('validate_receipt')}</button>
      </>}>
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Field label={t('receiving_warehouse')}>
          <select className={cls.input} value={warehouseId || defaultWarehouse} onChange={e => setWarehouseId(e.target.value)}>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label={t('delivery_note_ref')}><input className={cls.input} value={supplierRef} onChange={e => setSupplierRef(e.target.value)} /></Field>
      </div>
      <div className="overflow-x-auto">
        <table className={cls.table}>
          <thead><tr>
            <th className={cls.th}>{t('product')}</th>
            <th className={`${cls.th} text-end`}>{t('remaining')}</th>
            <th className={`${cls.th} text-end w-32`}>{t('qty_received')}</th>
            <th className={`${cls.th} text-end w-36`}>{t('actual_unit_cost')}</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-100">
            {doc.lines.map(l => (
              <tr key={l.id}>
                <td className={cls.td}>{l.description}</td>
                <td className={cls.tdNum}>{l.remaining}</td>
                <td className="px-2 py-1.5"><input type="number" min="0" step="any" className={`${cls.input} text-end ${n(qty[l.id]) > l.remaining ? 'border-red-500' : ''}`} value={qty[l.id]} onChange={e => setQty({ ...qty, [l.id]: e.target.value })} /></td>
                <td className="px-2 py-1.5"><input type="number" min="0" step="any" className={`${cls.input} text-end`} value={cost[l.id]} onChange={e => setCost({ ...cost, [l.id]: e.target.value })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {over && (
        <label className="mt-3 flex items-center gap-2 text-sm text-red-700">
          <input type="checkbox" checked={allowOver} onChange={e => setAllowOver(e.target.checked)} /> {t('allow_over_receipt')}
        </label>
      )}
      <p className="mt-3 text-xs text-zinc-500 text-start">{t('receipt_rule')}</p>
    </Modal>
  )
}

// ─── Réceptions ─────────────────────────────────────────────

export function ReceiptsList() {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const [rows, setRows] = useState<ReceiptRow[] | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [direct, setDirect] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await api<ReceiptRow[]>('/api/commercial/suppliers/receipts')
    if (r.ok) setRows(r.data); else { setRows([]); setError(r.error || t('error_generic')) }
  }, [t])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const o = new URLSearchParams(window.location.search).get('open')
    if (o) setOpenId(o)
  }, [])

  return (
    <StockPage>
      <PageHeader title={t('receipts_title')} description={t('receipts_desc')}
        actions={<button onClick={() => setDirect(true)} className={cls.btnPrimary}><Plus className="w-4 h-4" /> {t('direct_receipt')}</button>} />
      <PurchaseNav />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {info && <Alert tone="green" onClose={() => setInfo('')}>{info}</Alert>}
      <Card bodyClassName="p-0">
        {!rows ? <Loading /> : rows.length === 0 ? <EmptyState title={t('empty')} /> : (
          <div className="overflow-x-auto">
            <table className={cls.table}>
              <thead className="bg-zinc-50"><tr>
                <th className={cls.th}>{t('number')}</th>
                <th className={cls.th}>{t('date')}</th>
                <th className={cls.th}>{t('supplier')}</th>
                <th className={cls.th}>{t('order')}</th>
                <th className={cls.th}>{t('warehouse')}</th>
                <th className={cls.th}>{t('status')}</th>
                <th className={`${cls.th} text-end`}>{t('amount')}</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map(r => (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className={cls.td}><button onClick={() => setOpenId(r.id)} className="font-mono font-semibold text-teal-700 hover:underline">{r.number}</button></td>
                    <td className={cls.td}>{f.date(r.date)}</td>
                    <td className={cls.td}>{r.supplier?.name ?? '—'}</td>
                    <td className={cls.td}>{r.purchaseOrder ? <Link href={`/commercial/documents/supplier-orders/${r.purchaseOrder.id}`} className="hover:text-teal-700">{r.purchaseOrder.number}</Link> : <span className="text-zinc-400">{t('without_order')}</span>}</td>
                    <td className={cls.td}>{r.warehouse.name}</td>
                    <td className={cls.td}><PurchaseStatus status={r.status} />{r._count.returns > 0 && <>{' '}<span className="ms-1"><Badge tone="amber">{t('has_returns')}</Badge></span></>}</td>
                    <td className={cls.tdNum}>{f.money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-xs text-zinc-500 text-start">{t('receipt_rule')}</p>
      {direct && <DirectReceiptModal onClose={() => setDirect(false)} onDone={num => { setDirect(false); setInfo(t('receipt_done', { number: num })); load() }} />}
      {openId && <ReceiptModal id={openId} onClose={() => setOpenId(null)} onChanged={msg => { setInfo(msg); load() }} />}
    </StockPage>
  )
}

function DirectReceiptModal({ onClose, onDone }: { onClose: () => void; onDone: (number: string) => void }) {
  const t = useTranslations('Purchases')
  const { suppliers, warehouses, products, defaultWarehouse } = useRefs()
  const [supplierId, setSupplierId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [supplierRef, setSupplierRef] = useState('')
  const [lines, setLines] = useState<EditLine[]>([{ productId: '', description: '', quantity: '1', unitPrice: '0' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true); setError('')
    const r = await api<{ number: string }>('/api/commercial/suppliers/receipts', {
      method: 'POST',
      body: JSON.stringify({
        supplierId, warehouseId: warehouseId || defaultWarehouse, supplierRef: supplierRef || null, validate: true,
        items: lines.filter(l => l.productId && n(l.quantity) > 0).map(l => ({ productId: l.productId, description: l.description, quantity: n(l.quantity), unitCost: n(l.unitPrice) })),
      }),
    })
    setBusy(false)
    if (!r.ok) setError(r.error || t('error_generic')); else onDone(r.data.number)
  }

  return (
    <Modal open wide title={t('direct_receipt')} onClose={onClose}
      footer={<>
        <button className={cls.btnSecondary} onClick={onClose}>{t('cancel')}</button>
        <button className={cls.btnPrimary} disabled={busy || !supplierId} onClick={submit}><PackageCheck className="w-4 h-4" /> {t('validate_receipt')}</button>
      </>}>
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Field label={t('supplier')}>
          <select className={cls.input} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">{t('choose_supplier')}</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={t('receiving_warehouse')}>
          <select className={cls.input} value={warehouseId || defaultWarehouse} onChange={e => setWarehouseId(e.target.value)}>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </Field>
        <Field label={t('delivery_note_ref')}><input className={cls.input} value={supplierRef} onChange={e => setSupplierRef(e.target.value)} /></Field>
      </div>
      <LinesEditor lines={lines} setLines={setLines} products={products} priceLabel={t('actual_unit_cost')} />
      <p className="mt-3 text-xs text-zinc-500 text-start">{t('receipt_rule')}</p>
    </Modal>
  )
}

function ReceiptModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: (msg: string) => void }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const [r, setR] = useState<ReceiptDetail | null>(null)
  const [error, setError] = useState('')
  const [ret, setRet] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await api<ReceiptDetail>(`/api/commercial/suppliers/receipts/${id}`)
    if (res.ok) setR(res.data); else setError(res.error || t('error_generic'))
  }, [id, t])
  useEffect(() => { load() }, [load])

  async function act(action: 'validate' | 'cancel') {
    setBusy(true); setError('')
    const res = await api(`/api/commercial/suppliers/receipts/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
    setBusy(false)
    if (!res.ok) setError(res.error || t('error_generic')); else { onChanged(t(action === 'validate' ? 'receipt_validated' : 'receipt_cancelled')); load() }
  }
  async function doReturn() {
    const items = Object.entries(ret).filter(([, q]) => n(q) > 0).map(([receiptItemId, q]) => ({ receiptItemId, quantity: n(q) }))
    if (!items.length) return
    setBusy(true); setError('')
    const res = await api<{ number: string }>('/api/commercial/suppliers/returns', { method: 'POST', body: JSON.stringify({ receiptId: id, notes: notes || null, items }) })
    setBusy(false)
    if (!res.ok) setError(res.error || t('error_generic')); else { setRet({}); setNotes(''); onChanged(t('return_done', { number: res.data.number })); load() }
  }

  const canReturn = r?.status === 'VALIDATED' && r.items.some(i => i.returnable > 0)
  const returning = useMemo(() => Object.values(ret).some(q => n(q) > 0), [ret])

  return (
    <Modal open wide title={r ? `${t('receipt')} ${r.number}` : t('receipt')} onClose={onClose}
      footer={r && <>
        {r.status === 'DRAFT' && <button className={cls.btnSecondary} disabled={busy} onClick={() => act('cancel')}><XCircle className="w-4 h-4" /> {t('cancel_doc')}</button>}
        {r.status === 'DRAFT' && <button className={cls.btnPrimary} disabled={busy} onClick={() => act('validate')}><PackageCheck className="w-4 h-4" /> {t('validate_receipt')}</button>}
        {canReturn && <button className={cls.btnDanger} disabled={busy || !returning} onClick={doReturn}><Undo2 className="w-4 h-4" /> {t('create_return')}</button>}
      </>}>
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {!r ? (error ? null : <Loading />) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div><div className={cls.label}>{t('supplier')}</div>{r.supplier?.name ?? '—'}</div>
            <div><div className={cls.label}>{t('warehouse')}</div>{r.warehouse.name}</div>
            <div><div className={cls.label}>{t('date')}</div>{f.date(r.date)}</div>
            <div><div className={cls.label}>{t('status')}</div><PurchaseStatus status={r.status} /></div>
            <div><div className={cls.label}>{t('order')}</div>{r.purchaseOrder ? <Link href={`/commercial/documents/supplier-orders/${r.purchaseOrder.id}`} className="text-teal-700 hover:underline">{r.purchaseOrder.number}</Link> : t('without_order')}</div>
            <div><div className={cls.label}>{t('delivery_note_ref')}</div>{r.supplierRef ?? '—'}</div>
          </div>
          <div className="overflow-x-auto">
            <table className={cls.table}>
              <thead className="bg-zinc-50"><tr>
                <th className={cls.th}>{t('product')}</th>
                <th className={`${cls.th} text-end`}>{t('received')}</th>
                <th className={`${cls.th} text-end`}>{t('actual_unit_cost')}</th>
                <th className={`${cls.th} text-end`}>{t('returned')}</th>
                {canReturn && <th className={`${cls.th} text-end w-32`}>{t('qty_to_return')}</th>}
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {r.items.map(i => (
                  <tr key={i.id}>
                    <td className={cls.td}>{i.product.code} — {i.product.name}</td>
                    <td className={cls.tdNum}>{f.qty(i.quantity)} <span className="text-xs text-zinc-400">{i.product.unit}</span></td>
                    <td className={cls.tdNum}>{f.money(i.unitCost)}</td>
                    <td className={cls.tdNum}>{i.returned ? f.qty(i.returned) : '—'}</td>
                    {canReturn && <td className="px-2 py-1.5"><input type="number" min="0" max={i.returnable} step="any" disabled={i.returnable <= 0} className={`${cls.input} text-end`} value={ret[i.id] ?? ''} placeholder="0" onChange={e => setRet({ ...ret, [i.id]: e.target.value })} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canReturn && <Field label={t('return_reason')}><input className={cls.input} value={notes} onChange={e => setNotes(e.target.value)} /></Field>}
          {r.returns.length > 0 && (
            <div className="text-sm"><span className={cls.label}>{t('nav_returns')}</span>
              {r.returns.map(x => <span key={x.id} className="me-3 font-mono">{x.number} ({f.money(x.total)})</span>)}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

// ─── Retours fournisseurs ───────────────────────────────────

export function ReturnsList() {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const [rows, setRows] = useState<ReturnRow[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<ReturnRow[]>('/api/commercial/suppliers/returns').then(r => { if (r.ok) setRows(r.data); else { setRows([]); setError(r.error || t('error_generic')) } })
  }, [t])
  return (
    <StockPage>
      <PageHeader title={t('returns_title')} description={t('returns_desc')} />
      <PurchaseNav />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <Card bodyClassName="p-0">
        {!rows ? <Loading /> : rows.length === 0 ? <EmptyState title={t('empty')} /> : (
          <div className="overflow-x-auto">
            <table className={cls.table}>
              <thead className="bg-zinc-50"><tr>
                <th className={cls.th}>{t('number')}</th>
                <th className={cls.th}>{t('date')}</th>
                <th className={cls.th}>{t('supplier')}</th>
                <th className={cls.th}>{t('receipt')}</th>
                <th className={cls.th}>{t('warehouse')}</th>
                <th className={cls.th}>{t('lines')}</th>
                <th className={`${cls.th} text-end`}>{t('amount')}</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map(r => (
                  <tr key={r.id}>
                    <td className={`${cls.td} font-mono font-semibold`}>{r.number}</td>
                    <td className={cls.td}>{f.date(r.date)}</td>
                    <td className={cls.td}>{r.supplier?.name ?? '—'}</td>
                    <td className={cls.td}><Link href={`/commercial/documents/supplier-receipts?open=${r.receipt.id}`} className="font-mono text-teal-700 hover:underline">{r.receipt.number}</Link></td>
                    <td className={cls.td}>{r.warehouse.name}</td>
                    <td className={cls.td}>{r.items.map(i => `${i.product.code} × ${f.qty(i.quantity)}`).join(', ')}</td>
                    <td className={cls.tdNum}>{f.money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </StockPage>
  )
}

// ─── Alertes stock → brouillon de commande ──────────────────

export function PoFromAlertsButton({ items }: { items: Array<{ productId: string; suggestedQty: number }> }) {
  const t = useTranslations('Purchases')
  const router = useRouter()
  const { suppliers, warehouses, defaultWarehouse } = useRefs()
  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [warehouseId, setWarehouseId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    setBusy(true); setError('')
    const r = await api<{ id: string }>('/api/commercial/suppliers/orders/from-alerts', {
      method: 'POST',
      body: JSON.stringify({ supplierId, warehouseId: warehouseId || defaultWarehouse || null, items: items.filter(i => i.suggestedQty > 0).map(i => ({ productId: i.productId, quantity: i.suggestedQty })) }),
    })
    setBusy(false)
    if (!r.ok) setError(r.error || t('error_generic')); else router.push(`/commercial/documents/supplier-orders/${r.data.id}`)
  }

  return (
    <>
      <button onClick={() => setOpen(true)} disabled={!items.length} className={cls.btnPrimary}><Plus className="w-4 h-4" /> {t('create_po_from_alerts')}</button>
      <Modal open={open} title={t('create_po_from_alerts')} onClose={() => setOpen(false)}
        footer={<>
          <button className={cls.btnSecondary} onClick={() => setOpen(false)}>{t('cancel')}</button>
          <button className={cls.btnPrimary} disabled={busy || !supplierId} onClick={create}>{t('create_draft_po')}</button>
        </>}>
        {error && <Alert onClose={() => setError('')}>{error}</Alert>}
        <div className="space-y-3">
          <p className="text-sm text-zinc-600 text-start">{t('po_from_alerts_hint', { count: items.length })}</p>
          <Field label={t('supplier')}>
            <select className={cls.input} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">{t('choose_supplier')}</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={t('delivery_warehouse')}>
            <select className={cls.input} value={warehouseId || defaultWarehouse} onChange={e => setWarehouseId(e.target.value)}>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
        </div>
      </Modal>
    </>
  )
}
