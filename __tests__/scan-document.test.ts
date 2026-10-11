import { detectDocumentType, extractInvoice, mergeAiExtraction, normalizeDocKind, emptyExtraction } from '@/lib/invoice-extract'
import { mapExtractionToDraft, summarizeExtraction, suggestedTarget } from '@/lib/scan-document'
import { SCAN_HANDOFF_KEY, SCAN_HANDOFF_TTL_MS, saveScanHandoff, scanTargetHref, takeScanHandoff } from '@/lib/scan-handoff'

/** Bon de commande fournisseur : pas de FODEC ni de timbre, TVA 19 %. */
const BC = `SOCIETE TEXTILE DU SAHEL SARL
Route de Sousse Km 5, 4011 Hammam Sousse
MF : 1234567/A/M/000
BON DE COMMANDE N° BC-2026/044
Date : 08/10/2026
Client : BELLO CONFECTION
Réf  Désignation  Qté  P.U HT  Montant HT
REF-001  Fil coton peigné 30/1  100  12,500  1 250,000
REF-009  Ruban satin 10 mm  40  2,000  80,000
Total HT  1 330,000
TVA 19%  1 330,000  252,700
Total TTC  1 582,700`

const DEVIS = `ETS BEN SALAH & FILS
MF: 0987654X/A/P/000
DEVIS N° D-77
Sfax, le 12/09/2026
Etiquettes tissées  5 000  0,120  600,000
Total HT 600,000
TVA 19% 114,000
Total TTC 714,000`

const INVOICE_WITH_BC_REF = `SOCIETE TEXTILE DU SAHEL SARL
MF : 1234567/A/M/000
Réf. bon de commande : BC-2026/044
FACTURE N° FA-2026/0153
Date : 09/10/2026
Total HT 100,000
TVA 19% 19,000
Timbre fiscal 1,000
Total TTC 120,000`

const suppliers = [{ id: 's1', name: 'Société Textile du Sahel', matriculeFiscal: '1234567/A/M/000' }]
const products = [{ id: 'p1', code: 'REF-001', name: 'Fil coton peigné 30/1', purchasePrice: 12 }]

describe('detectDocumentType', () => {
  it.each([
    [BC, 'ORDER'],
    [DEVIS, 'QUOTE'],
    [INVOICE_WITH_BC_REF, 'INVOICE'],
    ['FACTURE PROFORMA N° 12\nTotal 10,000', 'QUOTE'],
    ['BON DE LIVRAISON N° BL-5\nArticle 3', 'DELIVERY_NOTE'],
    ['PURCHASE ORDER #PO-1\nTotal 10.000', 'ORDER'],
    ['أمر شراء عدد 15\nالمجموع', 'ORDER'],
    ['فاتورة عدد 15', 'INVOICE'],
  ])('%#', (text, kind) => expect(detectDocumentType(text).value).toBe(kind))

  it('aucun titre → null', () => expect(detectDocumentType('Liste de prix\nArticle 1  10,000')).toEqual({ value: null, confidence: 0 }))
  it('« suivant devis n° » ne fait pas d’une facture un devis', () => {
    expect(detectDocumentType('FACTURE N° 5\nSuivant devis n° D-1').value).toBe('INVOICE')
  })
})

describe('extractInvoice — bon de commande / devis', () => {
  it('BC : type, numéro de pièce, pas de timbre exigé', () => {
    const x = extractInvoice(BC)
    expect(x.documentType.value).toBe('ORDER')
    expect(x.invoiceNumber.value).toBe('BC-2026/044')
    expect(x.date.value).toBe('2026-10-08')
    expect(x.subtotal.value).toBe(1330)
    expect(x.total.value).toBe(1582.7)
    expect(x.stamp.value ?? 0).toBe(0)
    expect(x.checks.totalsConsistent).toBe(true)
    expect(x.lines).toHaveLength(2)
  })
  it('devis : numéro lu', () => {
    const x = extractInvoice(DEVIS)
    expect(x.documentType.value).toBe('QUOTE')
    expect(x.invoiceNumber.value).toBe('D-77')
  })
  it('facture citant son BC : le n° de facture, pas celui du BC', () => {
    const x = extractInvoice(INVOICE_WITH_BC_REF)
    expect(x.documentType.value).toBe('INVOICE')
    expect(x.invoiceNumber.value).toBe('FA-2026/0153')
  })
})

describe('normalizeDocKind / fusion IA', () => {
  it.each([
    ['bon_de_commande', 'ORDER'], ['devis', 'QUOTE'], ['Facture', 'INVOICE'], ['bon_de_livraison', 'DELIVERY_NOTE'],
    ['purchase order', 'ORDER'], ['ORDER', 'ORDER'], ['proforma', 'QUOTE'], ['autre', null], [null, null],
  ])('%s', (raw, kind) => expect(normalizeDocKind(raw as string | null)).toBe(kind))

  it("l'IA complète un type indéterminé, ne contredit pas un titre sûr", () => {
    const det = emptyExtraction()
    expect(mergeAiExtraction(det, { documentType: 'bon_de_commande' }).documentType.value).toBe('ORDER')
    const sure = extractInvoice(BC)
    expect(mergeAiExtraction(sure, { documentType: 'facture' }).documentType.value).toBe('ORDER')
  })
})

describe('mapExtractionToDraft — bon de commande', () => {
  const x = extractInvoice(BC)
  const d = mapExtractionToDraft(x, 'ORDER', suppliers, products, { globalLineLabel: 'Commande fournisseur' })

  it('fournisseur par MF, référence et date de la pièce', () => {
    expect(d.supplierId).toBe('s1')
    expect(d.newSupplier).toBeNull()
    expect(d.supplierRef).toBe('BC-2026/044')
    expect(d.date).toBe('2026-10-08')
  })
  it('lignes : article reconnu au prix du document, sinon texte libre à relire', () => {
    expect(d.lines[0]).toEqual({ productId: 'p1', description: 'REF-001 — Fil coton peigné 30/1', quantity: '100', unitPrice: '12.5', low: false })
    expect(d.lines[1].productId).toBe('')
    expect(d.lines[1].description).toContain('Ruban satin')
    expect(d.lines[1].quantity).toBe('40')
    expect(d.lines[1].unitPrice).toBe('2')
    expect(d.lines[1].low).toBe(true)
  })
  it('BC : TVA en taux, ni FODEC ni timbre', () => {
    expect(d.vatRate).toBe(19)
    expect(d.vatAmount).toBeNull()
    expect(d.fodec).toBeNull()
    expect(d.stamp).toBeNull()
    expect(d.low).not.toContain('stamp')
  })
  it('fournisseur inconnu → proposé à la création', () => {
    const d2 = mapExtractionToDraft(x, 'ORDER', [], products)
    expect(d2.supplierId).toBe('')
    expect(d2.newSupplier).toEqual({ name: 'SOCIETE TEXTILE DU SAHEL SARL', matriculeFiscal: '1234567/A/M/000' })
    expect(d2.low).toContain('supplier')
  })
  it('sans lignes → une ligne globale au total HT', () => {
    const e = { ...x, lines: [] }
    const d3 = mapExtractionToDraft(e, 'ORDER', suppliers, products, { globalLineLabel: 'Commande fournisseur' })
    expect(d3.lines).toEqual([{ productId: '', description: 'Commande fournisseur BC-2026/044', quantity: '1', unitPrice: '1330', low: true }])
  })
  it('plusieurs taux sur un BC → taux effectif à relire', () => {
    const multi = { ...x, vat: [{ rate: 19, base: 1000, amount: 190, confidence: 0.9 }, { rate: 7, base: 330, amount: 23.1, confidence: 0.9 }], vatTotal: { value: 213.1, confidence: 0.9 } }
    const d4 = mapExtractionToDraft(multi, 'ORDER', suppliers, products)
    expect(d4.vatRate).toBeCloseTo(16.02, 2)
    expect(d4.low).toContain('vat')
  })
})

describe('mapExtractionToDraft — facture', () => {
  it('reprend FODEC, timbre et montant de TVA ; ligne libre non signalée', () => {
    const x = extractInvoice(INVOICE_WITH_BC_REF)
    const d = mapExtractionToDraft(x, 'INVOICE', suppliers, products)
    expect(d.stamp).toBe(1)
    expect(d.vatAmount).toBe(19)
    expect(d.vatRate).toBe(19)
    expect(d.supplierRef).toBe('FA-2026/0153')
  })
})

describe('summarizeExtraction / suggestedTarget', () => {
  it('résumé du BC', () => {
    const s = summarizeExtraction(extractInvoice(BC))
    expect(s).toMatchObject({ kind: 'ORDER', reference: 'BC-2026/044', lineCount: 2, total: 1582.7, suggested: 'ORDER' })
  })
  it.each([['ORDER', 'ORDER'], ['QUOTE', 'ORDER'], ['INVOICE', 'INVOICE'], ['DELIVERY_NOTE', null], [null, null]] as const)('%s → %s', (k, t) => {
    expect(suggestedTarget(k)).toBe(t)
  })
})

describe('scan-handoff (sessionStorage)', () => {
  function memStorage() {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
  }
  const x = extractInvoice(BC)

  it('aller-retour, lecture unique', () => {
    const st = memStorage()
    expect(saveScanHandoff(st, 'ORDER', x, 1000)).toBe(true)
    expect(takeScanHandoff(st, 'ORDER', 2000)).toEqual(x)
    expect(takeScanHandoff(st, 'ORDER', 2000)).toBeNull()
  })
  it("destinée à l'autre formulaire : laissée en place", () => {
    const st = memStorage()
    saveScanHandoff(st, 'ORDER', x, 1000)
    expect(takeScanHandoff(st, 'INVOICE', 1000)).toBeNull()
    expect(st.m.has(SCAN_HANDOFF_KEY)).toBe(true)
  })
  it('périmée ou illisible → null et effacée', () => {
    const st = memStorage()
    saveScanHandoff(st, 'INVOICE', x, 0)
    expect(takeScanHandoff(st, 'INVOICE', SCAN_HANDOFF_TTL_MS + 1)).toBeNull()
    expect(st.m.has(SCAN_HANDOFF_KEY)).toBe(false)
    st.setItem(SCAN_HANDOFF_KEY, '{oops')
    expect(takeScanHandoff(st, 'INVOICE')).toBeNull()
    st.setItem(SCAN_HANDOFF_KEY, JSON.stringify({ v: 1, target: 'INVOICE', at: Date.now(), extraction: { foo: 1 } }))
    expect(takeScanHandoff(st, 'INVOICE')).toBeNull()
    expect(st.m.has(SCAN_HANDOFF_KEY)).toBe(false)
  })
  it('stockage indisponible → false / null sans exception', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') }, removeItem: () => {} }
    expect(saveScanHandoff(broken, 'ORDER', x)).toBe(false)
    expect(takeScanHandoff(broken, 'ORDER')).toBeNull()
  })
  it("l'URL ne transporte que le drapeau, jamais le contenu", () => {
    expect(scanTargetHref('ORDER')).toBe('/commercial/documents/supplier-orders?fromScan=1')
    expect(scanTargetHref('INVOICE')).toBe('/commercial/documents/supplier-invoices?fromScan=1')
  })
})
