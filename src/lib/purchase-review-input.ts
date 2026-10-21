/**
 * Normalise une extraction (OCR + IA) avant POST /api/scan/purchase-review : le schéma serveur borne les tailles
 * et refuse NaN/Infinity (sérialisés en null). Sans cela, le contrôle IA échouait en 400 et le panneau ne s'affichait jamais.
 */
import type { InvoiceExtraction } from './invoice-extract'

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)
const conf = (v: unknown) => Math.min(1, Math.max(0, num(v, 0)))
const KINDS = ['INVOICE', 'ORDER', 'QUOTE', 'DELIVERY_NOTE'] as const

type F<T> = { value: T | null; confidence: number }
const fStr = (f: unknown, max: number): F<string> => ({ value: str((f as F<string>)?.value, max), confidence: conf((f as F<string>)?.confidence) })
const fNum = (f: unknown): F<number> => ({ value: numOrNull((f as F<number>)?.value), confidence: conf((f as F<number>)?.confidence) })
const boolOrNull = (v: unknown) => (typeof v === 'boolean' ? v : null)

export function sanitizeExtractionForReview(x: InvoiceExtraction): InvoiceExtraction {
  const dt = x?.documentType?.value
  return {
    documentType: { value: (KINDS as readonly string[]).includes(dt as string) ? (dt as InvoiceExtraction['documentType']['value']) : null, confidence: conf(x?.documentType?.confidence) },
    supplierName: fStr(x?.supplierName, 300),
    matriculeFiscal: fStr(x?.matriculeFiscal, 60),
    invoiceNumber: fStr(x?.invoiceNumber, 120),
    date: fStr(x?.date, 30),
    subtotal: fNum(x?.subtotal),
    fodec: fNum(x?.fodec),
    vat: (Array.isArray(x?.vat) ? x.vat : []).slice(0, 10).map(v => ({ rate: num(v?.rate), base: numOrNull(v?.base), amount: num(v?.amount), confidence: conf(v?.confidence) })),
    vatTotal: fNum(x?.vatTotal),
    stamp: fNum(x?.stamp),
    total: fNum(x?.total),
    lines: (Array.isArray(x?.lines) ? x.lines : []).slice(0, 500).map(l => ({
      reference: str(l?.reference, 120),
      designation: str(l?.designation, 500) ?? '',
      quantity: num(l?.quantity),
      unitPrice: num(l?.unitPrice),
      total: num(l?.total),
      confidence: conf(l?.confidence),
    })),
    checks: {
      totalsConsistent: boolOrNull(x?.checks?.totalsConsistent),
      linesMatchSubtotal: boolOrNull(x?.checks?.linesMatchSubtotal),
      vatConsistent: boolOrNull(x?.checks?.vatConsistent),
      totalsGap: numOrNull(x?.checks?.totalsGap),
    },
    warnings: (Array.isArray(x?.warnings) ? x.warnings : []).filter(w => typeof w === 'string').slice(0, 50).map(w => w.slice(0, 300)),
  } as InvoiceExtraction
}
