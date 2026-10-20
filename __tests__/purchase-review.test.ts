/**
 * @jest-environment node
 */
import { reviewPurchase, purchaseAccount, supplierRsProfile } from '@/lib/purchase-review'
import type { InvoiceExtraction } from '@/lib/invoice-extract'

const f = <T,>(value: T | null, confidence = 0.95) => ({ value, confidence })

function extraction(over: Partial<InvoiceExtraction> = {}): InvoiceExtraction {
  return {
    documentType: f('INVOICE' as const),
    supplierName: f('SOTUVER SA'),
    matriculeFiscal: f('0001234A/A/M/000'),
    invoiceNumber: f('FA-2026-0412'),
    date: f('2026-09-15'),
    subtotal: f(2000),
    fodec: f(20),
    vat: [{ rate: 19, base: 2020, amount: 383.8, confidence: 0.9 }],
    vatTotal: f(383.8),
    stamp: f(1),
    total: f(2404.8),
    lines: [{ reference: 'BT-75', designation: 'Bouteilles verre 75 cl', quantity: 1000, unitPrice: 2, total: 2000, confidence: 0.9 }],
    checks: { totalsConsistent: true, linesMatchSubtotal: true, vatConsistent: true, totalsGap: 0 },
    warnings: [],
    ...over,
  }
}
const supplier = { id: 's1', name: 'SOTUVER SA', matriculeFiscal: '0001234A/A/M/000' }
const NOW = new Date('2026-10-20T10:00:00Z')

describe('scan IA — contrôle avant saisie d’une facture d’achat', () => {
  it('facture propre : prête, écriture équilibrée 607/4366/665/401, RS 1 % au paiement', () => {
    const r = reviewPurchase({ extraction: extraction(), matchedSupplier: supplier, existing: [], ownMatriculeFiscal: '7654321B/A/M/000', now: NOW })
    expect(r.amounts).toEqual({ ht: 2000, fodec: 20, vat: 383.8, stamp: 1, ttc: 2404.8 })
    expect(r.entry.balanced).toBe(true)
    expect(r.entry.lines.map(l => [l.account, l.debit, l.credit])).toEqual([
      ['607', 2020, 0], ['4366', 383.8, 0], ['665', 1, 0], ['401', 0, 2404.8],
    ])
    // PM d'après le matricule → IS 20 % supposé → 1 %, RS7_000002
    expect(r.rs).toMatchObject({ applies: true, rate: 0.01, amount: 24.048, tejCode: 'RS7_000002', netToPay: 2380.752, assumedRegime: true })
    expect(r.payment.lines.map(l => [l.account, l.debit, l.credit])).toEqual([['401', 2404.8, 0], ['532', 0, 2380.752], ['432', 0, 24.048]])
    expect(r.status).toBe('READY') // RS_REGIME_ASSUMED n'est qu'une info
    expect(r.issues.map(i => i.code)).toEqual(['RS_REGIME_ASSUMED'])
  })

  it('régime connu du fournisseur (dernière retenue) : 1,5 % pour une PP au réel', () => {
    const r = reviewPurchase({ extraction: extraction(), matchedSupplier: { ...supplier, regime: 'STANDARD', type: 'INDIVIDU' }, existing: [], now: NOW })
    expect(r.rs).toMatchObject({ rate: 0.015, amount: 36.072, tejCode: 'RS7_000001', assumedRegime: false })
  })

  it('moins de 1 000 DT TTC : pas de retenue', () => {
    const x = extraction({ subtotal: f(500), fodec: f(null), vat: [{ rate: 19, base: 500, amount: 95, confidence: 0.9 }], vatTotal: f(95), total: f(596) })
    const r = reviewPurchase({ extraction: x, matchedSupplier: supplier, existing: [], now: NOW })
    expect(r.rs).toMatchObject({ applies: false, amount: 0, netToPay: 596 })
    expect(r.payment.lines).toHaveLength(2)
  })

  it('doublon : même fournisseur et même n° (format différent) → bloqué', () => {
    const r = reviewPurchase({
      extraction: extraction(), matchedSupplier: supplier, now: NOW,
      existing: [{ id: 'p1', number: 'FF-0007', supplierId: 's1', supplierRef: 'fa 2026/0412', date: '2026-09-15', total: 2404.8 }],
    })
    expect(r.status).toBe('BLOCKED')
    expect(r.duplicates).toEqual([{ id: 'p1', number: 'FF-0007', reason: 'REF' }])
  })

  it('doublon probable : même date et même TTC sans n° identique → à vérifier', () => {
    const r = reviewPurchase({
      extraction: extraction(), matchedSupplier: supplier, now: NOW,
      existing: [{ id: 'p2', number: 'FF-0009', supplierId: 's1', supplierRef: 'AUTRE', date: '2026-09-15T00:00:00Z', total: '2404.800' }],
    })
    expect(r.status).toBe('TO_CHECK')
    expect(r.issues.find(i => i.code === 'DUPLICATE_AMOUNT')?.ref).toBe('FF-0009')
  })

  it('facture à son propre matricule (vente scannée par erreur) → bloqué', () => {
    const r = reviewPurchase({ extraction: extraction(), matchedSupplier: null, existing: [], ownMatriculeFiscal: '0001234A', now: NOW })
    expect(r.status).toBe('BLOCKED')
    expect(r.issues.map(i => i.code)).toContain('MF_IS_OWN')
    expect(r.issues.map(i => i.code)).toContain('NEW_SUPPLIER')
  })

  it('montants incohérents, matricule invalide, date future → à vérifier', () => {
    const x = extraction({
      matriculeFiscal: f('12345'), date: f('2027-01-05'), total: f(2500),
      checks: { totalsConsistent: false, linesMatchSubtotal: true, vatConsistent: true, totalsGap: 95.2 },
    })
    const r = reviewPurchase({ extraction: x, matchedSupplier: null, existing: [], now: NOW })
    expect(r.status).toBe('TO_CHECK')
    expect(r.issues.map(i => i.code)).toEqual(expect.arrayContaining(['MF_INVALID', 'TOTALS_MISMATCH', 'FUTURE_DATE']))
    expect(r.entry.balanced).toBe(false)
  })

  it('arrondi d’au plus 5 millimes absorbé sur la charge', () => {
    const x = extraction({ total: f(2404.803) })
    const r = reviewPurchase({ extraction: x, matchedSupplier: supplier, existing: [], now: NOW })
    expect(r.entry.balanced).toBe(true)
    expect(r.entry.lines[0].debit).toBe(2020.003)
  })

  it('compte de charge : prestations → 604, marchandises → 607', () => {
    expect(purchaseAccount(extraction()).account).toBe('607')
    expect(purchaseAccount(extraction({ lines: [{ reference: null, designation: 'Maintenance climatisation', quantity: 1, unitPrice: 300, total: 300, confidence: 0.9 }] })).account).toBe('604')
  })

  it('profil RS supposé d’après le matricule', () => {
    expect(supplierRsProfile(null, '1234567A/A/M/000')).toEqual({ type: 'SOCIETE', regime: 'IS_20', assumed: true })
    expect(supplierRsProfile(null, '1234567A/A/P/000')).toEqual({ type: 'INDIVIDU', regime: 'STANDARD', assumed: true })
    expect(supplierRsProfile({ regime: 'IS_10' }, null)).toEqual({ type: 'SOCIETE', regime: 'IS_10', assumed: false })
  })
})
