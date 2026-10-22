import { formatDocumentNumber, fiscalYearOf, documentPrefix, documentNumberPattern, nextDocumentNumberTx } from '@/lib/document-numbering'
import { computeDocumentTotals, resolveApplyStamp, defaultApplyStamp, DocumentTotalsError, hasZeroRatedLine } from '@/lib/document-totals'
import { resolveConversionTarget, findConversionConflict, collectChain, type ChainDoc } from '@/lib/document-conversion'
import { r3, vatExemptionMention, calculateLine } from '@/lib/fiscal'

describe('numérotation légale', () => {
  it('format FAC-2026-00001 par série', () => {
    expect(formatDocumentNumber('INVOICE', 2026, 1)).toBe('FAC-2026-00001')
    expect(formatDocumentNumber('INVOICE_SERVICE', 2026, 12)).toBe('FAC-2026-00012')
    expect(formatDocumentNumber('QUOTE', 2026, 3)).toBe('DEV-2026-00003')
    expect(formatDocumentNumber('CREDIT_NOTE', 2027, 1)).toBe('AV-2027-00001')
    expect(documentPrefix('DELIVERY_NOTE')).toBe('BL')
    expect(documentPrefix('ORDER')).toBe('BC')
  })
  it('exercice = année de la date du document', () => {
    expect(fiscalYearOf('2026-12-31')).toBe(2026)
    expect(fiscalYearOf('2027-01-01')).toBe(2027)
  })
  it('motif SQL', () => {
    expect(new RegExp(documentNumberPattern('INVOICE', 2026)).test('FAC-2026-00042')).toBe(true)
    expect(new RegExp(documentNumberPattern('INVOICE', 2026)).test('FAC-394351')).toBe(false)
  })
  it('nextDocumentNumberTx utilise la valeur renvoyée par la séquence', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([{ lastValue: BigInt(7) }]) }
    await expect(nextDocumentNumberTx(tx, 't1', 'INVOICE', '2026-05-02')).resolves.toBe('FAC-2026-00007')
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1)
  })
  it('nextDocumentNumberTx échoue si la séquence ne renvoie rien', async () => {
    const tx = { $queryRaw: jest.fn().mockResolvedValue([]) }
    await expect(nextDocumentNumberTx(tx, 't1', 'INVOICE')).rejects.toThrow()
  })
})

describe('recalcul serveur des totaux', () => {
  it('ignore les totaux client, arrondi au millime, timbre sur facture', () => {
    const { items, totals } = computeDocumentTotals(
      [{ quantity: 3, unitPriceHT: 33.3335, discount: 10, vatRate: 19, fodecApply: true, totalTTC: 999 } as any],
      { applyStamp: true },
    )
    expect(items[0].totalHT).toBe(90.0) // 3 × 33,3335 × 0,9 = 90,00045 → 90,000
    expect(items[0].fodecAmount).toBe(0.9)
    expect(items[0].vatAmount).toBe(17.271)
    expect(totals.timbreFiscal).toBe(1)
    expect(totals.totalTTC).toBe(r3(90 + 0.9 + 17.271 + 1))
  })
  it('devis 100 DT HT 19 % : pas de timbre', () => {
    const { totals } = computeDocumentTotals([{ quantity: 1, unitPriceHT: 100, vatRate: 19 }], { applyStamp: defaultApplyStamp('QUOTE') })
    expect(totals.totalTTC).toBe(119)
    expect(totals.timbreFiscal).toBe(0)
  })
  it('timbre : factures par défaut uniquement, case décochée respectée', () => {
    expect(resolveApplyStamp('INVOICE')).toBe(true)
    expect(resolveApplyStamp('INVOICE', { timbreFiscal: 0 })).toBe(false)
    expect(resolveApplyStamp('INVOICE', { applyTimbre: false })).toBe(false)
    expect(resolveApplyStamp('QUOTE')).toBe(false)
    expect(resolveApplyStamp('DELIVERY_NOTE', { timbreFiscal: 1 })).toBe(false)
    expect(resolveApplyStamp('CREDIT_NOTE')).toBe(false)
  })
  it('refuse taux de TVA non autorisé, remise > 100, quantité négative', () => {
    expect(() => computeDocumentTotals([{ quantity: 1, unitPriceHT: 1, vatRate: 18 }], { applyStamp: false })).toThrow(DocumentTotalsError)
    expect(() => computeDocumentTotals([{ quantity: 1, unitPriceHT: 1, discount: 120 }], { applyStamp: false })).toThrow(/remise/)
    expect(() => computeDocumentTotals([{ quantity: -1, unitPriceHT: 1 }], { applyStamp: false })).toThrow(/quantité/)
    expect(() => computeDocumentTotals([], { applyStamp: false })).toThrow()
  })
  it('TVA 0 % autorisée et mention', () => {
    const { items, totals } = computeDocumentTotals([{ quantity: 2, unitPriceHT: 50, vatRate: 0 }], { applyStamp: true })
    expect(hasZeroRatedLine(items)).toBe(true)
    expect(totals.totalVAT).toBe(0)
    expect(vatExemptionMention('SUSPENSION', 'A-123')).toMatch(/suspension.*A-123/)
    expect(vatExemptionMention('EXEMPT')).toMatch(/article 4/)
    expect(vatExemptionMention(null)).toBeNull()
  })
  it('calculateLine borne la remise', () => {
    expect(calculateLine({ quantity: 1, unitPriceHT: 10, discount: 150, vatRate: 19, fodecApply: false }).totalHT).toBe(0)
  })
})

describe('conversion de documents', () => {
  it('cibles autorisées', () => {
    expect(resolveConversionTarget('QUOTE')).toEqual({ ok: true, target: 'ORDER' })
    expect(resolveConversionTarget('QUOTE', 'INVOICE')).toEqual({ ok: true, target: 'INVOICE' })
    expect(resolveConversionTarget('ORDER', 'DELIVERY_NOTE')).toEqual({ ok: true, target: 'DELIVERY_NOTE' })
    expect(resolveConversionTarget('DELIVERY_NOTE')).toEqual({ ok: true, target: 'INVOICE' })
    expect(resolveConversionTarget('INVOICE')).toEqual({ ok: true, target: 'CREDIT_NOTE' })
    expect(resolveConversionTarget('QUOTE', 'DELIVERY_NOTE').ok).toBe(false)
    expect(resolveConversionTarget('CREDIT_NOTE').ok).toBe(false)
  })
  const d = (id: string, type: string, from: string | null = null, extra: Partial<ChainDoc> = {}): ChainDoc =>
    ({ id, type, status: 'PENDING', number: id, convertedFromId: from, originalInvoiceId: null, ...extra })
  it('pas de double conversion ni de deuxième facture dans la chaîne', () => {
    const quote = d('q', 'QUOTE'); const bc = d('bc', 'ORDER', 'q'); const bl = d('bl', 'DELIVERY_NOTE', 'bc'); const fac = d('f', 'INVOICE', 'bl')
    const all = [quote, bc, bl, fac]
    const chainFromBc = collectChain('bc', all)
    expect(chainFromBc.map(x => x.id).sort()).toEqual(['bc', 'bl', 'f', 'q'])
    expect(findConversionConflict(bc, 'INVOICE', chainFromBc)?.id).toBe('f')
    expect(findConversionConflict(quote, 'ORDER', collectChain('q', all))?.id).toBe('bc')
    expect(findConversionConflict(bc, 'DELIVERY_NOTE', chainFromBc)?.id).toBe('bl')
    // facture annulée : reconversion possible
    const cancelled = { ...fac, status: 'CANCELLED' }
    expect(findConversionConflict(bc, 'INVOICE', collectChain('bc', [quote, bc, bl, cancelled]))).toBeNull()
  })
  it('un seul avoir par conversion, lié à la facture d\'origine', () => {
    const fac = d('f', 'INVOICE'); const av = d('av', 'CREDIT_NOTE', null, { originalInvoiceId: 'f' })
    expect(findConversionConflict(fac, 'CREDIT_NOTE', collectChain('f', [fac, av]))?.id).toBe('av')
    expect(findConversionConflict(fac, 'CREDIT_NOTE', [fac])).toBeNull()
  })
})
