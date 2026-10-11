/**
 * Détection d'anomalies comptables / commerciales — logique PURE (aucun accès base).
 * Testée dans __tests__/anomalies.test.ts. Orchestration (chargement, stockage, email) : src/services/anomalies.ts.
 *
 * Chaque détecteur reçoit un instantané des données d'un tenant et renvoie des anomalies
 * avec une empreinte stable (fingerprint) : une anomalie re-détectée chaque nuit met à jour la même ligne.
 * Les montants sont en TND, arrondis au millime (0,001).
 */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type AnomalyStatus = 'OPEN' | 'IGNORED' | 'RESOLVED'
export type DocumentKind = 'SALES_INVOICE' | 'DELIVERY_NOTE' | 'SUPPLIER_INVOICE' | 'SUPPLIER_ORDER' | 'PRODUCT'

export const ANOMALY_TYPES = [
  'DUPLICATE_SUPPLIER_INVOICE',
  'INVOICE_TOTAL_MISMATCH',
  'MISSING_TIMBRE',
  'UNUSUAL_VAT_RATE',
  'OVERDUE_INVOICE',
  'NEGATIVE_STOCK',
  'SALE_BELOW_COST',
  'SUPPLIER_AMOUNT_OUTLIER',
  'DELIVERY_NOT_INVOICED',
  'RECEIPT_NOT_INVOICED',
  'INVOICE_NUMBER_GAP',
  'FUTURE_DATED_INVOICE',
] as const
export type AnomalyType = (typeof ANOMALY_TYPES)[number]

export const SEVERITY_ORDER: Record<Severity, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }
const SEVERITY_BASE: Record<Severity, number> = { CRITICAL: 85, HIGH: 65, MEDIUM: 45, LOW: 25 }

export type AnomalyParams = Record<string, string | number>

export interface DetectedAnomaly {
  type: AnomalyType
  severity: Severity
  score: number
  fingerprint: string
  documentKind: DocumentKind | null
  documentId: string | null
  documentRef: string | null
  amount: number | null
  /** Paramètres du message i18n Anomalies.types.<type>.detail (valeurs déjà formatées). */
  params: AnomalyParams
}

// ─── Instantané des données (chargé par le service) ─────────────────────────

export interface SalesItemSnap {
  productId: string | null
  description: string
  quantity: number
  unitPriceHT: number
  /** Remise en % de la ligne */
  discount: number
  vatRate: number
}

export interface SalesDocSnap {
  id: string
  number: string
  /** INVOICE | DELIVERY_NOTE | QUOTE | ORDER | CREDIT_NOTE … */
  type: string
  status: string
  date: Date
  dueDate: Date | null
  subtotalHT: number
  totalFodec: number
  totalVAT: number
  timbreFiscal: number
  totalTTC: number
  currency: string
  clientName: string
  convertedFromId: string | null
  items: SalesItemSnap[]
}

export interface PurchaseDocSnap {
  id: string
  number: string
  /** ORDER | INVOICE (normalisé) */
  type: 'ORDER' | 'INVOICE'
  status: string
  supplierId: string | null
  supplierName: string
  supplierRef: string | null
  date: Date
  subtotal: number
  taxRate: number
  taxAmount: number
  total: number
  linkedOrderId: string | null
  /** Date de la dernière réception validée (commandes) */
  lastReceiptAt: Date | null
}

export interface ProductSnap {
  id: string
  code: string
  name: string
  currentStock: number
  averageCost: number
  negativeWarehouses: { name: string; stock: number }[]
}

export interface AnomalySnapshot {
  now: Date
  sales: SalesDocSnap[]
  purchases: PurchaseDocSnap[]
  products: ProductSnap[]
}

export interface AnomalyConfig {
  /** Fenêtre d'analyse des documents récents (jours) */
  windowDays: number
  /** Facture client impayée au-delà de l'échéance + X jours */
  overdueDays: number
  /** Échéance par défaut quand la facture n'en a pas (jours après la date) */
  defaultPaymentTermDays: number
  /** BL non facturé après N jours */
  deliveryNoteDays: number
  /** Commande reçue sans facture fournisseur après N jours */
  receiptInvoiceDays: number
  /** Seuil de z-score (montant fournisseur inhabituel) */
  zThreshold: number
  /** Nombre minimal de factures passées du fournisseur pour calculer un z-score */
  minHistory: number
  /** Droit de timbre exigé sur les factures de vente en TND */
  timbreRequired: boolean
  /** Tolérance d'arrondi (TND) */
  tolerance: number
  /** Taux de TVA tunisiens admis */
  allowedVatRates: number[]
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  windowDays: 30,
  overdueDays: 30,
  defaultPaymentTermDays: 30,
  deliveryNoteDays: 7,
  receiptInvoiceDays: 15,
  zThreshold: 3,
  minHistory: 5,
  timbreRequired: true,
  tolerance: 0.001,
  allowedVatRates: [0, 7, 13, 19],
}

/** Fusionne la config par défaut avec Tenant.settings.anomalies (valeurs invalides ignorées). */
export function resolveAnomalyConfig(settings: unknown): AnomalyConfig {
  const cfg: AnomalyConfig = { ...DEFAULT_ANOMALY_CONFIG, allowedVatRates: [...DEFAULT_ANOMALY_CONFIG.allowedVatRates] }
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).anomalies : null
  if (!raw || typeof raw !== 'object') return cfg
  const r = raw as Record<string, unknown>
  const numKeys = ['windowDays', 'overdueDays', 'defaultPaymentTermDays', 'deliveryNoteDays', 'receiptInvoiceDays', 'zThreshold', 'minHistory'] as const
  for (const k of numKeys) {
    const v = Number(r[k])
    if (r[k] != null && Number.isFinite(v) && v > 0 && v <= 3650) cfg[k] = v
  }
  if (typeof r.timbreRequired === 'boolean') cfg.timbreRequired = r.timbreRequired
  if (Array.isArray(r.allowedVatRates) && r.allowedVatRates.every(x => Number.isFinite(Number(x)))) {
    cfg.allowedVatRates = r.allowedVatRates.map(Number)
  }
  return cfg
}

// ─── Utilitaires ────────────────────────────────────────────────────────────

const DAY = 86_400_000
export const r3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000
export const fmt3 = (n: number) => r3(n).toFixed(3)
const dayKey = (d: Date) => d.toISOString().slice(0, 10)
const daysBetween = (a: Date, b: Date) => Math.floor((a.getTime() - b.getTime()) / DAY)
const isCancelled = (s: string) => s === 'CANCELLED' || s === 'REJECTED'
const normRef = (s: string | null | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/** Statuts de facture de vente considérés comme « émise, non payée ». */
export const UNPAID_SALES_STATUSES = ['PENDING', 'SUBMITTED', 'CONFIRMED', 'SENT', 'ACCEPTED']

/** Score 0–100 : base de gravité + poids du montant (log) + bonus propre au détecteur (≤ 15). */
export function scoreAnomaly(severity: Severity, amount: number | null, bonus = 0): number {
  const amt = Math.abs(Number(amount) || 0)
  const amountBoost = Math.min(15, Math.log10(1 + amt) * 3)
  const s = SEVERITY_BASE[severity] + amountBoost + Math.max(0, Math.min(15, bonus))
  return Math.max(0, Math.min(100, Math.round(s)))
}

function make(
  type: AnomalyType,
  severity: Severity,
  fingerprint: string,
  doc: { kind: DocumentKind | null; id: string | null; ref: string | null },
  amount: number | null,
  params: AnomalyParams,
  bonus = 0,
): DetectedAnomaly {
  return {
    type,
    severity,
    score: scoreAnomaly(severity, amount, bonus),
    fingerprint: `${type}:${fingerprint}`,
    documentKind: doc.kind,
    documentId: doc.id,
    documentRef: doc.ref,
    amount: amount == null ? null : r3(amount),
    params,
  }
}

function inWindow(d: Date, s: AnomalySnapshot, c: AnomalyConfig) {
  return d.getTime() >= s.now.getTime() - c.windowDays * DAY
}

const salesInvoices = (s: AnomalySnapshot) => s.sales.filter(d => d.type === 'INVOICE')
const issued = (d: { status: string }) => d.status !== 'DRAFT' && !isCancelled(d.status)

// ─── Détecteurs ─────────────────────────────────────────────────────────────

/** Factures fournisseur en double : même fournisseur + même référence, ou même montant + même date. */
export function detectDuplicateSupplierInvoices(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const inv = s.purchases.filter(p => p.type === 'INVOICE' && !isCancelled(p.status) && p.supplierId)
  const out: DetectedAnomaly[] = []
  const paired = new Set<string>()
  const emit = (group: PurchaseDocSnap[], how: 'REF' | 'AMOUNT_DATE', severity: Severity) => {
    if (group.length < 2 || !group.some(g => inWindow(g.date, s, c))) return
    const sorted = [...group].sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id))
    const key = sorted.map(g => g.id).join('+')
    if (paired.has(key)) return
    paired.add(key)
    const last = sorted[sorted.length - 1]
    out.push(make('DUPLICATE_SUPPLIER_INVOICE', severity, `${how}:${key}`,
      { kind: 'SUPPLIER_INVOICE', id: last.id, ref: last.number }, last.total, {
        supplier: last.supplierName,
        refs: sorted.map(g => g.number + (g.supplierRef ? ` (${g.supplierRef})` : '')).join(', '),
        amount: fmt3(last.total),
        how: how === 'REF' ? 'ref' : 'amount_date',
      }))
  }
  const byRef = new Map<string, PurchaseDocSnap[]>()
  for (const p of inv) {
    const ref = normRef(p.supplierRef)
    if (!ref) continue
    const k = `${p.supplierId}|${ref}`
    byRef.set(k, [...(byRef.get(k) || []), p])
  }
  for (const g of byRef.values()) emit(g, 'REF', 'HIGH')
  const byAmt = new Map<string, PurchaseDocSnap[]>()
  for (const p of inv) {
    if (r3(p.total) <= 0) continue
    const k = `${p.supplierId}|${fmt3(p.total)}|${dayKey(p.date)}`
    byAmt.set(k, [...(byAmt.get(k) || []), p])
  }
  for (const g of byAmt.values()) {
    const ids = new Set(g.map(x => x.id))
    // déjà signalé par référence identique → pas de doublon de signalement
    const already = out.some(a => a.fingerprint.includes(':REF:') && [...ids].every(id => a.fingerprint.includes(id)))
    if (!already) emit(g, 'AMOUNT_DATE', 'MEDIUM')
  }
  return out
}

/** HT + FODEC + TVA + timbre ≠ TTC (vente) ; HT + TVA ≠ total (fournisseur, timbre de 1,000 toléré). */
export function detectTotalMismatches(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = []
  const tol = c.tolerance + 1e-9
  for (const d of salesInvoices(s)) {
    if (!issued(d) || !inWindow(d.date, s, c)) continue
    const expected = r3(d.subtotalHT + d.totalFodec + d.totalVAT + d.timbreFiscal)
    const diff = r3(d.totalTTC - expected)
    if (Math.abs(diff) > tol) {
      out.push(make('INVOICE_TOTAL_MISMATCH', 'HIGH', `S:${d.id}`, { kind: 'SALES_INVOICE', id: d.id, ref: d.number }, Math.abs(diff), {
        ref: d.number, ht: fmt3(d.subtotalHT), fodec: fmt3(d.totalFodec), tva: fmt3(d.totalVAT),
        timbre: fmt3(d.timbreFiscal), expected: fmt3(expected), ttc: fmt3(d.totalTTC), diff: fmt3(diff),
      }, Math.min(15, Math.abs(diff))))
    }
  }
  for (const p of s.purchases) {
    if (p.type !== 'INVOICE' || isCancelled(p.status) || !inWindow(p.date, s, c)) continue
    const expected = r3(p.subtotal + p.taxAmount)
    const diff = r3(p.total - expected)
    if (Math.abs(diff) > tol && Math.abs(diff - 1) > tol) {
      out.push(make('INVOICE_TOTAL_MISMATCH', 'HIGH', `P:${p.id}`, { kind: 'SUPPLIER_INVOICE', id: p.id, ref: p.number }, Math.abs(diff), {
        ref: p.number, ht: fmt3(p.subtotal), fodec: fmt3(0), tva: fmt3(p.taxAmount),
        timbre: fmt3(0), expected: fmt3(expected), ttc: fmt3(p.total), diff: fmt3(diff),
      }, Math.min(15, Math.abs(diff))))
    }
  }
  return out
}

/** Facture de vente en TND émise sans droit de timbre (exonérations possibles : export, régimes suspensifs). */
export function detectMissingTimbre(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  if (!c.timbreRequired) return []
  return salesInvoices(s)
    .filter(d => issued(d) && inWindow(d.date, s, c) && (d.currency || 'TND') === 'TND' && d.totalTTC > 0 && r3(d.timbreFiscal) <= 0)
    .map(d => make('MISSING_TIMBRE', 'MEDIUM', d.id, { kind: 'SALES_INVOICE', id: d.id, ref: d.number }, d.totalTTC, {
      ref: d.number, client: d.clientName, ttc: fmt3(d.totalTTC),
    }))
}

/** Taux de TVA hors 0/7/13/19 % (lignes de vente, en-tête fournisseur, ou TVA incohérente avec le taux). */
export function detectUnusualVatRates(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const allowed = (r: number) => c.allowedVatRates.some(a => Math.abs(a - r) < 0.0001)
  const out: DetectedAnomaly[] = []
  for (const d of s.sales) {
    if (!['INVOICE', 'DELIVERY_NOTE', 'CREDIT_NOTE'].includes(d.type) || !issued(d) || !inWindow(d.date, s, c)) continue
    const bad = [...new Set(d.items.map(i => r3(i.vatRate)).filter(r => !allowed(r)))]
    if (bad.length) {
      out.push(make('UNUSUAL_VAT_RATE', 'MEDIUM', `S:${d.id}`, { kind: d.type === 'DELIVERY_NOTE' ? 'DELIVERY_NOTE' : 'SALES_INVOICE', id: d.id, ref: d.number }, d.totalVAT, {
        ref: d.number, rates: bad.map(r => `${r} %`).join(', '), allowed: c.allowedVatRates.join(' / '),
      }))
    }
  }
  for (const p of s.purchases) {
    if (p.type !== 'INVOICE' || isCancelled(p.status) || !inWindow(p.date, s, c) || p.subtotal <= 0) continue
    const effective = r3((p.taxAmount / p.subtotal) * 100)
    const rateOk = allowed(r3(p.taxRate))
    const consistent = Math.abs(r3(p.subtotal * p.taxRate / 100) - r3(p.taxAmount)) <= 0.01
    if (!rateOk || !consistent) {
      out.push(make('UNUSUAL_VAT_RATE', rateOk ? 'LOW' : 'MEDIUM', `P:${p.id}`, { kind: 'SUPPLIER_INVOICE', id: p.id, ref: p.number }, p.taxAmount, {
        ref: p.number, rates: `${r3(p.taxRate)} % (${effective} %)`, allowed: c.allowedVatRates.join(' / '),
      }))
    }
  }
  return out
}

/** Factures clients émises, non payées, en retard de plus de X jours après l'échéance. */
export function detectOverdueInvoices(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = []
  for (const d of salesInvoices(s)) {
    if (!UNPAID_SALES_STATUSES.includes(d.status)) continue
    const due = d.dueDate ?? new Date(d.date.getTime() + c.defaultPaymentTermDays * DAY)
    const late = daysBetween(s.now, due)
    if (late <= c.overdueDays) continue
    const severity: Severity = late > 90 ? 'HIGH' : 'MEDIUM'
    out.push(make('OVERDUE_INVOICE', severity, d.id, { kind: 'SALES_INVOICE', id: d.id, ref: d.number }, d.totalTTC, {
      ref: d.number, client: d.clientName, ttc: fmt3(d.totalTTC), days: late, due: dayKey(due),
    }, Math.min(10, late / 30)))
  }
  return out
}

/** Stock négatif (produit ou dépôt). */
export function detectNegativeStock(s: AnomalySnapshot): DetectedAnomaly[] {
  const out: DetectedAnomaly[] = []
  for (const p of s.products) {
    const negWh = p.negativeWarehouses.filter(w => r3(w.stock) < 0)
    if (r3(p.currentStock) >= 0 && negWh.length === 0) continue
    const qty = r3(p.currentStock) < 0 ? r3(p.currentStock) : Math.min(...negWh.map(w => r3(w.stock)))
    out.push(make('NEGATIVE_STOCK', r3(p.currentStock) < 0 ? 'HIGH' : 'MEDIUM', p.id, { kind: 'PRODUCT', id: p.id, ref: p.code },
      Math.abs(qty) * (p.averageCost || 0), {
        product: `${p.code} — ${p.name}`, stock: r3(p.currentStock),
        warehouses: negWh.length ? negWh.map(w => `${w.name} : ${r3(w.stock)}`).join(', ') : '—',
      }))
  }
  return out
}

/** Ventes facturées sous le coût moyen pondéré (CMUP) du produit. Remise de ligne en %. */
export function detectSalesBelowCost(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const products = new Map(s.products.map(p => [p.id, p]))
  const out: DetectedAnomaly[] = []
  for (const d of salesInvoices(s)) {
    if (!issued(d) || !inWindow(d.date, s, c)) continue
    const seen = new Set<string>()
    for (const it of d.items) {
      const p = it.productId ? products.get(it.productId) : undefined
      if (!p || !(p.averageCost > 0) || !(it.quantity > 0) || seen.has(p.id)) continue
      const net = r3(it.unitPriceHT * (1 - (Number(it.discount) || 0) / 100))
      if (net >= r3(p.averageCost) - c.tolerance) continue
      seen.add(p.id)
      const loss = r3((p.averageCost - net) * it.quantity)
      const severity: Severity = net < p.averageCost * 0.8 ? 'HIGH' : 'MEDIUM'
      out.push(make('SALE_BELOW_COST', severity, `${d.id}:${p.id}`, { kind: 'SALES_INVOICE', id: d.id, ref: d.number }, loss, {
        ref: d.number, product: `${p.code} — ${p.name}`, price: fmt3(net), cost: fmt3(p.averageCost), loss: fmt3(loss),
      }))
    }
  }
  return out
}

/** Montant de facture fournisseur inhabituel par rapport à l'historique du fournisseur (z-score). */
export function detectSupplierAmountOutliers(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const inv = s.purchases.filter(p => p.type === 'INVOICE' && !isCancelled(p.status) && p.supplierId && p.total > 0)
  const out: DetectedAnomaly[] = []
  for (const p of inv) {
    if (!inWindow(p.date, s, c)) continue
    const hist = inv.filter(h => h.supplierId === p.supplierId && h.id !== p.id && h.date.getTime() < p.date.getTime()).map(h => h.total)
    if (hist.length < c.minHistory) continue
    const z = zScore(p.total, hist)
    const avg = mean(hist)
    if (z < c.zThreshold || p.total < avg * 1.5) continue
    out.push(make('SUPPLIER_AMOUNT_OUTLIER', z >= 5 ? 'HIGH' : 'MEDIUM', p.id, { kind: 'SUPPLIER_INVOICE', id: p.id, ref: p.number }, p.total, {
      ref: p.number, supplier: p.supplierName, amount: fmt3(p.total), average: fmt3(avg), z: Math.round(z * 10) / 10, n: hist.length,
    }, Math.min(10, z)))
  }
  return out
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** z-score avec écart-type d'échantillon ; écart-type plancher = 10 % de la moyenne (historique très régulier). */
export function zScore(x: number, hist: number[]): number {
  if (hist.length < 2) return 0
  const m = mean(hist)
  const variance = hist.reduce((a, b) => a + (b - m) ** 2, 0) / (hist.length - 1)
  const sd = Math.max(Math.sqrt(variance), Math.abs(m) * 0.1, 0.001)
  return (x - m) / sd
}

/** Bons de livraison sans facture (aucune facture convertie depuis le BL) après N jours. */
export function detectDeliveryNotesNotInvoiced(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const invoicedFrom = new Set(s.sales.filter(d => d.type === 'INVOICE' && !isCancelled(d.status) && d.convertedFromId).map(d => d.convertedFromId))
  const maxAge = Math.max(c.windowDays * 3, c.deliveryNoteDays + c.windowDays)
  return s.sales
    .filter(d => d.type === 'DELIVERY_NOTE' && !isCancelled(d.status) && d.status !== 'DRAFT' && !invoicedFrom.has(d.id))
    .filter(d => { const age = daysBetween(s.now, d.date); return age > c.deliveryNoteDays && age <= maxAge })
    .map(d => {
      const age = daysBetween(s.now, d.date)
      return make('DELIVERY_NOT_INVOICED', age > 30 ? 'HIGH' : 'MEDIUM', d.id, { kind: 'DELIVERY_NOTE', id: d.id, ref: d.number }, d.totalTTC, {
        ref: d.number, client: d.clientName, days: age, ttc: fmt3(d.totalTTC),
      }, Math.min(10, age / 10))
    })
}

/** Commande fournisseur reçue (totalement ou partiellement) sans facture fournisseur liée après N jours. */
export function detectReceiptsNotInvoiced(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const invoicedOrders = new Set(s.purchases.filter(p => p.type === 'INVOICE' && !isCancelled(p.status) && p.linkedOrderId).map(p => p.linkedOrderId))
  const out: DetectedAnomaly[] = []
  for (const po of s.purchases) {
    if (po.type !== 'ORDER' || !['RECEIVED', 'PARTIALLY_RECEIVED'].includes(po.status) || invoicedOrders.has(po.id)) continue
    const ref = po.lastReceiptAt ?? po.date
    const age = daysBetween(s.now, ref)
    if (age <= c.receiptInvoiceDays || age > 180) continue
    out.push(make('RECEIPT_NOT_INVOICED', 'MEDIUM', po.id, { kind: 'SUPPLIER_ORDER', id: po.id, ref: po.number }, po.total, {
      ref: po.number, supplier: po.supplierName, days: age, amount: fmt3(po.total),
      partial: po.status === 'PARTIALLY_RECEIVED' ? 'partial' : 'full',
    }, Math.min(10, age / 10)))
  }
  return out
}

/** Découpe « FAC-2026-0012 » en préfixe « FAC-2026- » + 12 (null si le numéro ne finit pas par des chiffres). */
export function splitInvoiceNumber(n: string): { prefix: string; seq: number; width: number } | null {
  const m = /^(.*?[^0-9])?([0-9]+)$/.exec((n || '').trim())
  if (!m) return null
  return { prefix: m[1] || '', seq: parseInt(m[2], 10), width: m[2].length }
}

/** Trous dans la numérotation des factures de vente (par préfixe), sur la fenêtre d'analyse. */
export function detectInvoiceNumberGaps(s: AnomalySnapshot, c: AnomalyConfig): DetectedAnomaly[] {
  const groups = new Map<string, { seq: number; width: number; date: Date }[]>()
  for (const d of salesInvoices(s)) {
    const p = splitInvoiceNumber(d.number)
    if (!p) continue
    groups.set(p.prefix, [...(groups.get(p.prefix) || []), { seq: p.seq, width: p.width, date: d.date }])
  }
  const out: DetectedAnomaly[] = []
  for (const [prefix, list] of groups) {
    if (list.length < 3) continue
    const sorted = [...list].sort((a, b) => a.seq - b.seq)
    const missing: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i]
      if (cur.seq - prev.seq <= 1 || !inWindow(cur.date, s, c)) continue
      for (let n = prev.seq + 1; n < cur.seq && missing.length < 500; n++) missing.push(n)
    }
    if (!missing.length) continue
    const width = sorted[sorted.length - 1].width
    const label = (n: number) => `${prefix}${String(n).padStart(width, '0')}`
    out.push(make('INVOICE_NUMBER_GAP', 'MEDIUM', `${prefix}:${missing.join(',')}`, { kind: null, id: null, ref: prefix || null }, null, {
      prefix: prefix || '—', count: missing.length, numbers: compactRanges(missing).map(([a, b]) => (a === b ? label(a) : `${label(a)} → ${label(b)}`)).slice(0, 10).join(', '),
    }, Math.min(10, missing.length * 2)))
  }
  return out
}

export function compactRanges(nums: number[]): [number, number][] {
  const s = [...new Set(nums)].sort((a, b) => a - b)
  const out: [number, number][] = []
  for (const n of s) {
    const last = out[out.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else out.push([n, n])
  }
  return out
}

/** Factures de vente datées de plus d'un jour dans le futur (une seule anomalie regroupée). */
export function detectFutureDatedInvoices(s: AnomalySnapshot): DetectedAnomaly[] {
  const fut = salesInvoices(s).filter(d => !isCancelled(d.status) && d.date.getTime() > s.now.getTime() + DAY)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  if (!fut.length) return []
  const total = fut.reduce((a, d) => a + d.totalTTC, 0)
  const first = fut[0]
  return [make('FUTURE_DATED_INVOICE', fut.length > 5 ? 'MEDIUM' : 'LOW', 'SALES', { kind: fut.length === 1 ? 'SALES_INVOICE' : null, id: fut.length === 1 ? first.id : null, ref: first.number }, total, {
    count: fut.length, refs: fut.slice(0, 5).map(d => `${d.number} (${dayKey(d.date)})`).join(', ') + (fut.length > 5 ? '…' : ''),
    last: dayKey(fut[fut.length - 1].date),
  })]
}

/** Lance tous les détecteurs. Un détecteur qui plante n'empêche pas les autres (erreur remontée). */
export function detectAnomalies(s: AnomalySnapshot, c: AnomalyConfig = DEFAULT_ANOMALY_CONFIG): { anomalies: DetectedAnomaly[]; errors: string[] } {
  const detectors: [string, () => DetectedAnomaly[]][] = [
    ['duplicates', () => detectDuplicateSupplierInvoices(s, c)],
    ['totals', () => detectTotalMismatches(s, c)],
    ['timbre', () => detectMissingTimbre(s, c)],
    ['vat', () => detectUnusualVatRates(s, c)],
    ['overdue', () => detectOverdueInvoices(s, c)],
    ['negativeStock', () => detectNegativeStock(s)],
    ['belowCost', () => detectSalesBelowCost(s, c)],
    ['outliers', () => detectSupplierAmountOutliers(s, c)],
    ['deliveryNotes', () => detectDeliveryNotesNotInvoiced(s, c)],
    ['receipts', () => detectReceiptsNotInvoiced(s, c)],
    ['gaps', () => detectInvoiceNumberGaps(s, c)],
    ['future', () => detectFutureDatedInvoices(s)],
  ]
  const anomalies: DetectedAnomaly[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  for (const [name, run] of detectors) {
    try {
      for (const a of run()) {
        if (seen.has(a.fingerprint)) continue
        seen.add(a.fingerprint)
        anomalies.push(a)
      }
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { anomalies: sortAnomalies(anomalies), errors }
}

/** Tri : score décroissant, puis gravité, puis montant, puis empreinte (ordre stable). */
export function sortAnomalies<T extends { score: number; severity: string; amount?: number | null | unknown; fingerprint: string }>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    b.score - a.score
    || (SEVERITY_ORDER[b.severity as Severity] || 0) - (SEVERITY_ORDER[a.severity as Severity] || 0)
    || (Math.abs(Number(b.amount) || 0) - Math.abs(Number(a.amount) || 0))
    || a.fingerprint.localeCompare(b.fingerprint))
}

/** Top N (défaut 3) des anomalies ouvertes, pour l'email et le widget. Les ignorées / résolues sont exclues. */
export function pickTop<T extends { score: number; severity: string; amount?: number | null | unknown; fingerprint: string; status?: string }>(list: T[], n = 3): T[] {
  return sortAnomalies(list.filter(a => !a.status || a.status === 'OPEN')).slice(0, n)
}

/** Lien (sans préfixe de langue) vers le document concerné. */
export function documentPath(kind: string | null | undefined, id: string | null | undefined): string {
  switch (kind) {
    case 'SALES_INVOICE': return id ? `/commercial/invoices/${id}` : '/commercial/documents'
    case 'DELIVERY_NOTE': return '/commercial/documents/delivery-notes'
    case 'SUPPLIER_INVOICE': return id ? `/commercial/documents/supplier-invoices/${id}` : '/commercial/documents/supplier-invoices'
    case 'SUPPLIER_ORDER': return id ? `/commercial/documents/supplier-orders/${id}` : '/commercial/documents/supplier-orders'
    case 'PRODUCT': return id ? `/stock/products/${id}` : '/stock/products'
    default: return '/anomalies'
  }
}

/**
 * Fusion d'une détection avec l'état en base :
 *  - nouvelle → OPEN ; IGNORED reste ignorée (faux positif assumé) ;
 *  - RESOLVED re-détectée → rouverte (le problème est toujours là) ;
 *  - OPEN non re-détectée → RESOLVED automatiquement.
 */
export function reconcileStatus(existing: AnomalyStatus | null, detectedNow: boolean): AnomalyStatus {
  if (!detectedNow) return existing === 'OPEN' ? 'RESOLVED' : (existing ?? 'RESOLVED')
  if (existing === 'IGNORED') return 'IGNORED'
  return 'OPEN'
}

/** Remplace {param} dans un gabarit de message (sans syntaxe ICU). */
export function interpolate(template: string, params: AnomalyParams = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined ? m : String(params[k])))
}
