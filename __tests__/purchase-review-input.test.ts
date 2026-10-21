import { sanitizeExtractionForReview } from '@/lib/purchase-review-input'
import { extractInvoice } from '@/lib/invoice-extract'
import { withTimeout } from '@/lib/fetch-timeout'

describe('sanitizeExtractionForReview', () => {
  it('borne les tailles et remplace NaN', () => {
    const x = extractInvoice('FACTURE N° 12\nTotal HT 100,000\nTVA 19% 19,000\nTimbre 1,000\nTotal TTC 120,000')
    const dirty = {
      ...x,
      warnings: Array.from({ length: 80 }, () => 'w'.repeat(400)),
      lines: [{ reference: null, designation: 'd'.repeat(900), quantity: NaN, unitPrice: Infinity, total: 1, confidence: 2 }],
      subtotal: { value: NaN, confidence: 0.5 },
      documentType: { value: 'UNKNOWN' as never, confidence: 1 },
    }
    const s = sanitizeExtractionForReview(dirty)
    expect(s.warnings).toHaveLength(50)
    expect(s.warnings[0]).toHaveLength(300)
    expect(s.lines[0]).toMatchObject({ quantity: 0, unitPrice: 0, confidence: 1 })
    expect(s.lines[0].designation).toHaveLength(500)
    expect(s.subtotal.value).toBeNull()
    expect(s.documentType.value).toBeNull()
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

describe('withTimeout', () => {
  it('renvoie la valeur de repli si la promesse ne se termine pas', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'fallback')).resolves.toBe('fallback')
    await expect(withTimeout(Promise.resolve('ok'), 20, 'fallback')).resolves.toBe('ok')
    await expect(withTimeout(Promise.reject(new Error('x')), 20, null)).resolves.toBeNull()
  })
})
