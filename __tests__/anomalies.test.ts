/** Détecteurs d'anomalies (logique pure), score / top 3, réconciliation des statuts, email matinal. */
import {
  DEFAULT_ANOMALY_CONFIG as C,
  compactRanges,
  detectAnomalies,
  detectDeliveryNotesNotInvoiced,
  detectDuplicateSupplierInvoices,
  detectFutureDatedInvoices,
  detectInvoiceNumberGaps,
  detectMissingTimbre,
  detectNegativeStock,
  detectOverdueInvoices,
  detectReceiptsNotInvoiced,
  detectSalesBelowCost,
  detectSupplierAmountOutliers,
  detectTotalMismatches,
  detectUnusualVatRates,
  documentPath,
  interpolate,
  pickTop,
  reconcileStatus,
  resolveAnomalyConfig,
  scoreAnomaly,
  splitInvoiceNumber,
  zScore,
  type AnomalySnapshot,
  type PurchaseDocSnap,
  type SalesDocSnap,
} from '@/lib/anomalies'
import { buildAnomalyEmail, describeAnomaly, tenantLocale } from '@/lib/anomaly-email'

const NOW = new Date('2026-10-11T04:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

let seq = 0
const sale = (o: Partial<SalesDocSnap> = {}): SalesDocSnap => ({
  id: `s${++seq}`, number: `FAC-2026-${String(seq).padStart(4, '0')}`, type: 'INVOICE', status: 'SENT',
  date: daysAgo(5), dueDate: null, subtotalHT: 100, totalFodec: 0, totalVAT: 19, timbreFiscal: 1, totalTTC: 120,
  currency: 'TND', clientName: 'Client A', convertedFromId: null,
  items: [{ productId: null, description: 'x', quantity: 1, unitPriceHT: 100, discount: 0, vatRate: 19 }], ...o,
})
const purchase = (o: Partial<PurchaseDocSnap> = {}): PurchaseDocSnap => ({
  id: `p${++seq}`, number: `FF-2026-${seq}`, type: 'INVOICE', status: 'VALIDATED', supplierId: 'sup1', supplierName: 'Fournisseur X',
  supplierRef: null, date: daysAgo(3), subtotal: 1000, taxRate: 19, taxAmount: 190, total: 1190, linkedOrderId: null, lastReceiptAt: null, ...o,
})
const snap = (o: Partial<AnomalySnapshot> = {}): AnomalySnapshot => ({ now: NOW, sales: [], purchases: [], products: [], ...o })

describe('factures fournisseur en double', () => {
  it('même fournisseur + même référence (normalisée) → HIGH', () => {
    const a = purchase({ supplierRef: 'FA-12/34', date: daysAgo(40) })
    const b = purchase({ supplierRef: 'fa 1234', total: 900, subtotal: 756.303, taxAmount: 143.697 })
    const r = detectDuplicateSupplierInvoices(snap({ purchases: [a, b] }), C)
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ type: 'DUPLICATE_SUPPLIER_INVOICE', severity: 'HIGH', documentId: b.id })
  })
  it('même montant + même date → MEDIUM, pas de doublon de signalement si déjà vu par référence', () => {
    const a = purchase({ supplierRef: 'R1' }), b = purchase({ supplierRef: 'R1' })
    const c = purchase({ supplierId: 'sup2', date: daysAgo(2) }), d = purchase({ supplierId: 'sup2', date: daysAgo(2) })
    const r = detectDuplicateSupplierInvoices(snap({ purchases: [a, b, c, d] }), C)
    expect(r.map(x => x.severity).sort()).toEqual(['HIGH', 'MEDIUM'])
  })
  it('ignore fournisseurs différents, factures annulées et paires entièrement hors fenêtre', () => {
    const r = detectDuplicateSupplierInvoices(snap({ purchases: [
      purchase({ supplierRef: 'R', supplierId: 'a' }), purchase({ supplierRef: 'R', supplierId: 'b' }),
      purchase({ supplierRef: 'Z' }), purchase({ supplierRef: 'Z', status: 'CANCELLED' }),
      purchase({ supplierRef: 'OLD', date: daysAgo(100) }), purchase({ supplierRef: 'OLD', date: daysAgo(90) }),
    ] }), C)
    expect(r).toHaveLength(0)
  })
})

describe('totaux incohérents', () => {
  it('HT + FODEC + TVA + timbre ≠ TTC au-delà de 0,001', () => {
    const ok = sale({ subtotalHT: 100, totalFodec: 1, totalVAT: 19.19, timbreFiscal: 1, totalTTC: 121.19 })
    const rounding = sale({ subtotalHT: 100, totalVAT: 19, timbreFiscal: 1, totalTTC: 120.001 })
    const bad = sale({ subtotalHT: 100, totalVAT: 19, timbreFiscal: 1, totalTTC: 119 })
    const r = detectTotalMismatches(snap({ sales: [ok, rounding, bad] }), C)
    expect(r.map(x => x.documentId)).toEqual([bad.id])
    expect(r[0].params).toMatchObject({ expected: '120.000', ttc: '119.000', diff: '-1.000' })
  })
  it('facture fournisseur : HT + TVA = total, timbre de 1,000 toléré', () => {
    const r = detectTotalMismatches(snap({ purchases: [
      purchase({ total: 1190 }), purchase({ total: 1191 }), purchase({ id: 'bad', total: 1200 }),
    ] }), C)
    expect(r.map(x => x.documentId)).toEqual(['bad'])
  })
  it('ignore brouillons et annulées', () => {
    expect(detectTotalMismatches(snap({ sales: [sale({ status: 'DRAFT', totalTTC: 1 }), sale({ status: 'CANCELLED', totalTTC: 1 })] }), C)).toHaveLength(0)
  })
})

describe('timbre fiscal', () => {
  it('signale une facture TND émise sans timbre, pas en devise ni si désactivé', () => {
    const miss = sale({ timbreFiscal: 0, totalTTC: 119 })
    const eur = sale({ timbreFiscal: 0, currency: 'EUR' })
    expect(detectMissingTimbre(snap({ sales: [miss, eur, sale()] }), C).map(a => a.documentId)).toEqual([miss.id])
    expect(detectMissingTimbre(snap({ sales: [miss] }), { ...C, timbreRequired: false })).toHaveLength(0)
  })
})

describe('taux de TVA', () => {
  it('lignes de vente hors 0/7/13/19', () => {
    const bad = sale({ items: [{ productId: null, description: 'a', quantity: 1, unitPriceHT: 10, discount: 0, vatRate: 18 }, { productId: null, description: 'b', quantity: 1, unitPriceHT: 10, discount: 0, vatRate: 7 }] })
    const r = detectUnusualVatRates(snap({ sales: [bad, sale()] }), C)
    expect(r).toHaveLength(1)
    expect(r[0].params.rates).toBe('18 %')
  })
  it('facture fournisseur : taux interdit (MEDIUM) ou TVA incohérente avec le taux (LOW)', () => {
    const r = detectUnusualVatRates(snap({ purchases: [
      purchase({ id: 'rate', taxRate: 15, taxAmount: 150, total: 1150 }),
      purchase({ id: 'mix', taxRate: 0, taxAmount: 33.1, total: 1033.1 }),
      purchase({ id: 'ok' }),
    ] }), C)
    expect(Object.fromEntries(r.map(a => [a.documentId, a.severity]))).toEqual({ rate: 'MEDIUM', mix: 'LOW' })
  })
})

describe('impayés en retard', () => {
  it('au-delà de X jours après l’échéance (échéance par défaut = date + 30 j), statuts non payés seulement', () => {
    const late = sale({ dueDate: daysAgo(45) })
    const veryLate = sale({ date: daysAgo(200), dueDate: null })
    const r = detectOverdueInvoices(snap({ sales: [late, veryLate, sale({ dueDate: daysAgo(10) }), sale({ dueDate: daysAgo(100), status: 'PAID' }), sale({ dueDate: daysAgo(100), status: 'DRAFT' })] }), C)
    expect(Object.fromEntries(r.map(a => [a.documentId, [a.severity, a.params.days]]))).toEqual({ [late.id]: ['MEDIUM', 45], [veryLate.id]: ['HIGH', 170] })
  })
})

describe('stock', () => {
  it('stock négatif produit (HIGH) ou dépôt seul (MEDIUM)', () => {
    const r = detectNegativeStock(snap({ products: [
      { id: 'a', code: 'A', name: 'A', currentStock: -3, averageCost: 10, negativeWarehouses: [{ name: 'Dépôt 1', stock: -3 }] },
      { id: 'b', code: 'B', name: 'B', currentStock: 5, averageCost: 10, negativeWarehouses: [{ name: 'Dépôt 2', stock: -2 }] },
      { id: 'c', code: 'C', name: 'C', currentStock: 0, averageCost: 10, negativeWarehouses: [] },
    ] }))
    expect(r.map(a => [a.documentId, a.severity])).toEqual([['a', 'HIGH'], ['b', 'MEDIUM']])
    expect(r[0].amount).toBe(30)
  })
  it('vente sous le CMUP (remise en %)', () => {
    const products = [{ id: 'p', code: 'P', name: 'Prod', currentStock: 10, averageCost: 50, negativeWarehouses: [] }]
    const below = sale({ items: [{ productId: 'p', description: '', quantity: 2, unitPriceHT: 60, discount: 25, vatRate: 19 }] })
    const above = sale({ items: [{ productId: 'p', description: '', quantity: 2, unitPriceHT: 60, discount: 10, vatRate: 19 }] })
    const r = detectSalesBelowCost(snap({ sales: [below, above], products }), C)
    expect(r).toHaveLength(1)
    expect(r[0].params).toMatchObject({ price: '45.000', cost: '50.000', loss: '10.000' })
    expect(r[0].severity).toBe('MEDIUM')
  })
})

describe('montant fournisseur inhabituel (z-score)', () => {
  it('signale un montant très au-dessus de l’historique, pas avec un historique trop court', () => {
    const hist = [1000, 1100, 950, 1050, 1000, 980].map((t, i) => purchase({ total: t, date: daysAgo(300 - i * 30) }))
    const big = purchase({ id: 'big', total: 5000 })
    const r = detectSupplierAmountOutliers(snap({ purchases: [...hist, big] }), C)
    expect(r.map(a => a.documentId)).toEqual(['big'])
    expect(r[0].severity).toBe('HIGH')
    expect(detectSupplierAmountOutliers(snap({ purchases: [...hist.slice(0, 3), big] }), C)).toHaveLength(0)
  })
  it('zScore : écart-type plancher de 10 % de la moyenne', () => {
    expect(zScore(110, [100, 100, 100])).toBeCloseTo(1)
    expect(zScore(5, [5])).toBe(0)
  })
})

describe('documents non facturés', () => {
  it('BL non facturé après N jours (facture convertie = facturé)', () => {
    const bl1 = sale({ id: 'bl1', type: 'DELIVERY_NOTE', number: 'BL-1', date: daysAgo(10) })
    const bl2 = sale({ id: 'bl2', type: 'DELIVERY_NOTE', number: 'BL-2', date: daysAgo(10) })
    const recent = sale({ id: 'bl3', type: 'DELIVERY_NOTE', number: 'BL-3', date: daysAgo(2) })
    const inv = sale({ convertedFromId: 'bl2' })
    expect(detectDeliveryNotesNotInvoiced(snap({ sales: [bl1, bl2, recent, inv] }), C).map(a => a.documentId)).toEqual(['bl1'])
  })
  it('commande reçue sans facture fournisseur liée après N jours', () => {
    const po = purchase({ id: 'po', type: 'ORDER', status: 'PARTIALLY_RECEIVED', lastReceiptAt: daysAgo(20) })
    const poInv = purchase({ id: 'po2', type: 'ORDER', status: 'RECEIVED', lastReceiptAt: daysAgo(20) })
    const linked = purchase({ linkedOrderId: 'po2' })
    const fresh = purchase({ id: 'po3', type: 'ORDER', status: 'RECEIVED', lastReceiptAt: daysAgo(3) })
    const r = detectReceiptsNotInvoiced(snap({ purchases: [po, poInv, linked, fresh] }), C)
    expect(r.map(a => [a.documentId, a.params.partial])).toEqual([['po', 'partial']])
  })
})

describe('numérotation', () => {
  it('splitInvoiceNumber / compactRanges', () => {
    expect(splitInvoiceNumber('FAC-2026-0012')).toEqual({ prefix: 'FAC-2026-', seq: 12, width: 4 })
    expect(splitInvoiceNumber('FAC-CL1-LX9Z')).toBeNull()
    expect(compactRanges([5, 3, 4, 9])).toEqual([[3, 5], [9, 9]])
  })
  it('trous par préfixe, uniquement si le numéro suivant est dans la fenêtre', () => {
    const mk = (n: string, d: number) => sale({ number: n, date: daysAgo(d) })
    const r = detectInvoiceNumberGaps(snap({ sales: [
      mk('FAC-2026-0001', 10), mk('FAC-2026-0002', 9), mk('FAC-2026-0005', 8), mk('FAC-2026-0006', 7),
      mk('AV-0001', 200), mk('AV-0003', 150), mk('AV-0004', 120),
    ] }), C)
    expect(r).toHaveLength(1)
    expect(r[0].params).toMatchObject({ prefix: 'FAC-2026-', count: 2, numbers: 'FAC-2026-0003 → FAC-2026-0004' })
  })
})

describe('factures datées dans le futur', () => {
  it('regroupe en une seule anomalie', () => {
    const r = detectFutureDatedInvoices(snap({ sales: [sale({ date: daysAgo(-10) }), sale({ date: daysAgo(-20) }), sale()] }))
    expect(r).toHaveLength(1)
    expect(r[0].params.count).toBe(2)
    expect(r[0].fingerprint).toBe('FUTURE_DATED_INVOICE:SALES')
  })
})

describe('score, top 3, statuts', () => {
  it('le score croît avec la gravité et le montant, borné à 100', () => {
    expect(scoreAnomaly('HIGH', 10)).toBeGreaterThan(scoreAnomaly('MEDIUM', 10))
    expect(scoreAnomaly('MEDIUM', 100000)).toBeGreaterThan(scoreAnomaly('MEDIUM', 10))
    expect(scoreAnomaly('CRITICAL', 1e12, 99)).toBe(100)
  })
  it('pickTop : 3 meilleures ouvertes, ignorées / résolues exclues, ordre stable', () => {
    const list = [
      { fingerprint: 'a', score: 50, severity: 'MEDIUM', amount: 1, status: 'OPEN' },
      { fingerprint: 'b', score: 90, severity: 'HIGH', amount: 1, status: 'IGNORED' },
      { fingerprint: 'c', score: 70, severity: 'HIGH', amount: 1, status: 'OPEN' },
      { fingerprint: 'd', score: 70, severity: 'HIGH', amount: 500, status: 'OPEN' },
      { fingerprint: 'e', score: 60, severity: 'MEDIUM', amount: 1, status: 'RESOLVED' },
      { fingerprint: 'f', score: 40, severity: 'LOW', amount: 1, status: 'OPEN' },
    ]
    expect(pickTop(list).map(x => x.fingerprint)).toEqual(['d', 'c', 'a'])
    expect(pickTop(list, 10)).toHaveLength(4)
  })
  it('reconcileStatus', () => {
    expect(reconcileStatus(null, true)).toBe('OPEN')
    expect(reconcileStatus('IGNORED', true)).toBe('IGNORED')
    expect(reconcileStatus('RESOLVED', true)).toBe('OPEN')
    expect(reconcileStatus('OPEN', false)).toBe('RESOLVED')
    expect(reconcileStatus('IGNORED', false)).toBe('IGNORED')
  })
  it('detectAnomalies : agrège, dédoublonne, trie et isole les erreurs', () => {
    const s = snap({ sales: [sale({ timbreFiscal: 0, totalTTC: 119 }), sale({ dueDate: daysAgo(120), totalTTC: 5001, subtotalHT: 4200, totalVAT: 800 })] })
    const { anomalies, errors } = detectAnomalies(s)
    expect(errors).toEqual([])
    expect(anomalies.map(a => a.type)).toEqual(['OVERDUE_INVOICE', 'MISSING_TIMBRE'])
    const broken = { ...s, products: null as unknown as [] }
    expect(detectAnomalies(broken).errors.length).toBeGreaterThan(0)
  })
  it('resolveAnomalyConfig lit Tenant.settings.anomalies et ignore les valeurs invalides', () => {
    const c = resolveAnomalyConfig({ anomalies: { overdueDays: 60, windowDays: -1, timbreRequired: false, allowedVatRates: [0, 19] } })
    expect(c).toMatchObject({ overdueDays: 60, windowDays: 30, timbreRequired: false, allowedVatRates: [0, 19] })
    expect(resolveAnomalyConfig(null)).toEqual(C)
  })
  it('documentPath', () => {
    expect(documentPath('SALES_INVOICE', 'x')).toBe('/commercial/invoices/x')
    expect(documentPath('SUPPLIER_ORDER', 'y')).toBe('/commercial/documents/supplier-orders/y')
    expect(documentPath(null, null)).toBe('/anomalies')
  })
})

describe('email matinal', () => {
  const top = [
    { type: 'OVERDUE_INVOICE', severity: 'HIGH', documentKind: 'SALES_INVOICE', documentId: 'inv1', details: { ref: 'FAC-1', client: 'A&B <script>', ttc: '10.000', days: 40, due: '2026-09-01' } },
    { type: 'NEGATIVE_STOCK', severity: 'MEDIUM', documentKind: 'PRODUCT', documentId: 'p1', details: { product: 'P', stock: -2, warehouses: '—' } },
  ]
  it('FR : sujet « N points à vérifier », liens prod, HTML échappé, reste compté', () => {
    const e = buildAnomalyEmail({ locale: 'fr', tenantName: 'Démo', openCount: 5, top, appUrl: 'https://app.test' })
    expect(e.subject).toBe('5 points à vérifier ce matin — Démo')
    expect(e.html).toContain('https://app.test/fr/commercial/invoices/inv1')
    expect(e.html).toContain('https://app.test/fr/anomalies')
    expect(e.html).toContain('A&amp;B &lt;script&gt;')
    expect(e.html).not.toContain('<script>')
    expect(e.text).toContain('… et 3 autre(s).')
  })
  it('singulier, AR en RTL, EN', () => {
    expect(buildAnomalyEmail({ locale: 'fr', tenantName: 'T', openCount: 1, top: top.slice(0, 1), appUrl: 'x' }).subject).toBe('1 point à vérifier ce matin — T')
    const ar = buildAnomalyEmail({ locale: 'ar', tenantName: 'T', openCount: 2, top, appUrl: 'x' })
    expect(ar.html).toContain('dir="rtl"')
    expect(ar.html).toContain('x/ar/stock/products/p1')
    expect(buildAnomalyEmail({ locale: 'en', tenantName: 'T', openCount: 2, top, appUrl: 'x' }).subject).toBe('2 items to review this morning — T')
  })
  it('describeAnomaly / interpolate / tenantLocale', () => {
    expect(describeAnomaly({ type: 'MISSING_TIMBRE', details: { ref: 'F1', client: 'C', ttc: '9.000' } }, 'fr').detail).toBe('F1 (C, 9.000 TND) émise sans droit de timbre')
    expect(describeAnomaly({ type: 'UNKNOWN', details: {} }, 'fr').title).toBe('UNKNOWN')
    expect(interpolate('{a}-{b}', { a: 1 })).toBe('1-{b}')
    expect(tenantLocale({ locale: 'ar' })).toBe('ar')
    expect(tenantLocale({})).toBe('fr')
  })
})
