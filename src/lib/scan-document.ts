/**
 * « Scanner un document » — transformation PURE d'une extraction (facture, bon de commande, devis, BL)
 * en brouillon de pièce d'achat : facture fournisseur ou bon de commande fournisseur.
 * Aucune dépendance navigateur / serveur : testé par Jest, partagé par le formulaire et la page /commercial/scan.
 */
import {
  LOW_CONFIDENCE, matchProduct, matchSupplier, round3,
  type InvoiceExtraction, type ProductCandidate, type PurchaseDocKind, type SupplierCandidate,
} from '@/lib/invoice-extract'

export type PurchaseTarget = 'INVOICE' | 'ORDER'

export type DraftLine = { productId: string; description: string; quantity: string; unitPrice: string; low?: boolean }

export type PurchaseDraft = {
  supplierId: string
  /** Fournisseur lu mais inconnu : proposé à la création */
  newSupplier: { name: string; matriculeFiscal: string | null } | null
  /** N° de la pièce fournisseur (facture, BC, devis…) */
  supplierRef: string
  /** ISO yyyy-mm-dd ou '' */
  date: string
  /** Taux de TVA unique (ou taux effectif si plusieurs taux sur un BC) ; null = inchangé */
  vatRate: number | null
  /** Montant de TVA lu (facture) ; null = calculé depuis le taux */
  vatAmount: number | null
  /** Facture seulement */
  fodec: number | null
  stamp: number | null
  /** Plusieurs taux de TVA : détail [{rate, amount}] */
  vatBreakdown: Array<{ rate: number; amount: number }>
  lines: DraftLine[]
  /** Champs à relire : supplier, ref, date, vat, fodec, stamp, totals */
  low: string[]
}

type Product = ProductCandidate & { purchasePrice?: string | number; averageCost?: string | number }

/** Cible proposée par défaut pour un type détecté : BC et devis → bon de commande ; facture → facture ; sinon aucune. */
export function suggestedTarget(kind: PurchaseDocKind | null | undefined): PurchaseTarget | null {
  if (kind === 'ORDER' || kind === 'QUOTE') return 'ORDER'
  if (kind === 'INVOICE') return 'INVOICE'
  return null
}

/**
 * Extraction → brouillon de facture ou de bon de commande.
 * - fournisseur : matricule fiscal puis nom ; inconnu → proposé à la création ;
 * - lignes : article reconnu (référence / nom) avec le prix du document, sinon texte libre ; à défaut une ligne globale (total HT) ;
 * - BC : ni FODEC ni timbre (le timbre fiscal n'est dû que sur la facture), TVA reprise en taux ; aucun effet sur le stock.
 */
export function mapExtractionToDraft(
  x: InvoiceExtraction,
  target: PurchaseTarget,
  suppliers: SupplierCandidate[],
  products: Product[],
  opts: { globalLineLabel?: string } = {},
): PurchaseDraft {
  const low = new Set<string>()
  const mark = (k: string, c: number, has: boolean) => { if (!has || c < LOW_CONFIDENCE) low.add(k) }
  const isInvoice = target === 'INVOICE'

  let supplierId = ''
  let newSupplier: PurchaseDraft['newSupplier'] = null
  const m = matchSupplier(x, suppliers)
  if (m) { supplierId = m.id; if (m.by === 'name' && m.score < 0.9) low.add('supplier') }
  else {
    low.add('supplier')
    newSupplier = x.supplierName.value ? { name: x.supplierName.value, matriculeFiscal: x.matriculeFiscal.value } : null
  }

  const supplierRef = x.invoiceNumber.value ?? ''
  mark('ref', x.invoiceNumber.confidence, !!x.invoiceNumber.value)
  const date = x.date.value ?? ''
  mark('date', x.date.confidence, !!x.date.value)

  // TVA
  let vatRate: number | null = null
  let vatAmount: number | null = null
  const vatBreakdown = x.vat.length > 1 ? x.vat.map((v) => ({ rate: v.rate, amount: v.amount })) : []
  const vatTotal = x.vatTotal.value ?? (x.vat.length ? round3(x.vat.reduce((s, v) => s + v.amount, 0)) : null)
  if (x.vat.length === 1) vatRate = x.vat[0].rate
  if (isInvoice) {
    if (vatTotal !== null) vatAmount = vatTotal
  } else if (x.vat.length > 1 && vatTotal !== null && x.subtotal.value) {
    // BC : un seul taux par pièce → taux effectif, à relire
    vatRate = Math.round((vatTotal / x.subtotal.value) * 10000) / 100
    low.add('vat')
  }
  if (isInvoice) mark('vat', x.vatTotal.confidence, x.vatTotal.value !== null)
  else if (x.vat.length === 1 && x.vat[0].confidence < LOW_CONFIDENCE) low.add('vat') // BC sans TVA lue : taux par défaut, rien à signaler

  // FODEC / timbre : facture seulement
  const fodec = isInvoice && x.fodec.value ? x.fodec.value : null
  if (isInvoice && x.fodec.value) mark('fodec', x.fodec.confidence, true)
  const stamp = isInvoice && x.stamp.value ? x.stamp.value : null
  if (isInvoice) mark('stamp', x.stamp.confidence, x.stamp.value !== null)

  // Lignes
  const lines: DraftLine[] = x.lines.map((l) => {
    const p = matchProduct(l, products)
    const prod = p ? products.find((pp) => pp.id === p.id) : undefined
    return {
      productId: prod?.id ?? '',
      description: prod ? `${prod.code} — ${prod.name}` : [l.reference, l.designation].filter(Boolean).join(' '),
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      low: l.confidence < LOW_CONFIDENCE || !prod,
    }
  })
  // Facture : une ligne en texte libre reste valable (charge) ; seul un BC exige un article pour la réception
  if (isInvoice) lines.forEach((l, i) => { l.low = x.lines[i].confidence < LOW_CONFIDENCE })
  if (!lines.length && x.subtotal.value !== null) {
    lines.push({ productId: '', description: [opts.globalLineLabel ?? '', x.invoiceNumber.value].filter(Boolean).join(' ').trim(), quantity: '1', unitPrice: String(x.subtotal.value), low: true })
  }
  if (x.checks.totalsConsistent === false) low.add('totals')

  return { supplierId, newSupplier, supplierRef, date, vatRate, vatAmount, fodec, stamp, vatBreakdown, lines, low: [...low] }
}

/** Résumé affiché par la page « Scanner un document ». */
export type ScanSummary = {
  kind: PurchaseDocKind | null
  supplierName: string | null
  matriculeFiscal: string | null
  reference: string | null
  date: string | null
  lineCount: number
  subtotal: number | null
  total: number | null
  suggested: PurchaseTarget | null
}

export function summarizeExtraction(x: InvoiceExtraction): ScanSummary {
  return {
    kind: x.documentType?.value ?? null,
    supplierName: x.supplierName.value,
    matriculeFiscal: x.matriculeFiscal.value,
    reference: x.invoiceNumber.value,
    date: x.date.value,
    lineCount: x.lines.length,
    subtotal: x.subtotal.value,
    total: x.total.value,
    suggested: suggestedTarget(x.documentType?.value),
  }
}
