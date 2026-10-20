/**
 * POST /api/scan/purchase-review { extraction } — contrôle d'une facture d'achat scannée avant saisie :
 * fournisseur reconnu, matricule, doublons, cohérence des montants, retenue à la source à opérer au paiement,
 * écritures proposées (journal des achats + règlement). Ne crée rien : la saisie reste validée par l'utilisateur.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { matchSupplier, type InvoiceExtraction } from '@/lib/invoice-extract'
import { reviewPurchase, type ReviewSupplier } from '@/lib/purchase-review'
import { PURCHASE_INVOICE_TYPES } from '@/lib/firm-dashboard'
import { tejMatricule, type BeneficiaryRegime, type BeneficiaryType } from '@/lib/retenue-source'

export const runtime = 'nodejs'

const field = <T extends z.ZodTypeAny>(t: T) => z.object({ value: t.nullable(), confidence: z.number() })
const extractionSchema = z.object({
  supplierName: field(z.string().max(300)),
  matriculeFiscal: field(z.string().max(60)),
  invoiceNumber: field(z.string().max(120)),
  date: field(z.string().max(30)),
  subtotal: field(z.number()),
  fodec: field(z.number()),
  vat: z.array(z.object({ rate: z.number(), base: z.number().nullable(), amount: z.number(), confidence: z.number() })).max(10),
  vatTotal: field(z.number()),
  stamp: field(z.number()),
  total: field(z.number()),
  lines: z.array(z.object({ reference: z.string().max(120).nullable(), designation: z.string().max(500), quantity: z.number(), unitPrice: z.number(), total: z.number(), confidence: z.number() })).max(500),
  checks: z.object({ totalsConsistent: z.boolean().nullable(), linesMatchSubtotal: z.boolean().nullable(), vatConsistent: z.boolean().nullable(), totalsGap: z.number().nullable() }),
  warnings: z.array(z.string().max(300)).max(50).default([]),
  documentType: field(z.enum(['INVOICE', 'ORDER', 'QUOTE', 'DELIVERY_NOTE'])).optional(),
})
const bodySchema = z.object({ extraction: extractionSchema })

const REGIMES: BeneficiaryRegime[] = ['IS_20', 'IS_10', 'STANDARD', 'FORFAIT', 'HOTEL']

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(bodySchema, body)
    if (data instanceof NextResponse) return data
    const x = data.extraction as unknown as InvoiceExtraction

    const [tenant, suppliers] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { matriculeFiscal: true } }),
      prisma.supplier.findMany({ where: { tenantId: ctx.tenantId, isActive: true }, select: { id: true, name: true, matriculeFiscal: true }, take: 5000 }),
    ])
    const m = matchSupplier(x, suppliers)
    const sup = m ? suppliers.find((s) => s.id === m.id) ?? null : null

    let matched: ReviewSupplier | null = null
    let existing: Array<{ id: string; number: string; supplierId: string | null; supplierRef: string | null; date: Date; total: unknown }> = []
    if (sup) {
      // Régime RS : repris de la dernière retenue opérée sur ce fournisseur, s'il y en a une
      const key = tejMatricule(sup.matriculeFiscal ?? x.matriculeFiscal.value)
      const lastRs = key
        ? await prisma.withholdingTax.findFirst({
            where: { tenantId: ctx.tenantId, beneficiaryTin: { startsWith: key.slice(0, 7) }, beneficiaryRegime: { not: null } },
            orderBy: { createdAt: 'desc' }, select: { beneficiaryRegime: true, beneficiaryType: true },
          })
        : null
      const regime = REGIMES.includes(lastRs?.beneficiaryRegime as BeneficiaryRegime) ? (lastRs!.beneficiaryRegime as BeneficiaryRegime) : null
      matched = { ...sup, regime, type: regime ? (String(lastRs!.beneficiaryType) as BeneficiaryType) : null }
      existing = await prisma.purchaseOrder.findMany({
        where: { tenantId: ctx.tenantId, supplierId: sup.id, type: { in: PURCHASE_INVOICE_TYPES }, status: { not: 'CANCELLED' }, date: { gte: new Date(Date.now() - 2 * 365 * 86_400_000) } },
        select: { id: true, number: true, supplierId: true, supplierRef: true, date: true, total: true },
        take: 2000,
      })
    }

    const review = reviewPurchase({ extraction: x, matchedSupplier: matched, existing, ownMatriculeFiscal: tenant?.matriculeFiscal ?? null })
    return NextResponse.json({ review, supplier: sup ? { id: sup.id, name: sup.name, by: m?.by } : null })
  } catch (err) {
    return handleApiError(err, 'POST scan/purchase-review')
  }
}
