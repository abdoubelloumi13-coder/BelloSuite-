/**
 * PATCH /api/scan/documents/:id { reviewStatus: 'PROCESSED' | 'REJECTED' | 'TO_REVIEW', purchaseId? }
 * Classe une pièce scannée (compteur « pièces à traiter » du tableau de bord cabinet).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireTenant } from '@/lib/api-auth'
import { parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'

const schema = z.object({
  reviewStatus: z.enum(['TO_REVIEW', 'PROCESSED', 'REJECTED']),
  purchaseId: z.string().uuid().nullable().optional(),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireTenant(req)
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(schema, body)
    if (data instanceof NextResponse) return data
    if (data.purchaseId && (await prisma.purchaseOrder.count({ where: { id: data.purchaseId, tenantId: ctx.tenantId } })) === 0) {
      return NextResponse.json({ error: 'Référence invalide (purchaseOrder)' }, { status: 400 })
    }
    const res = await prisma.scannedDocument.updateMany({
      where: { id, tenantId: ctx.tenantId },
      data: {
        reviewStatus: data.reviewStatus,
        ...(data.purchaseId !== undefined ? { purchaseId: data.purchaseId } : {}),
        reviewedAt: data.reviewStatus === 'TO_REVIEW' ? null : new Date(),
        reviewedBy: data.reviewStatus === 'TO_REVIEW' ? null : ctx.user.id,
      },
    })
    if (res.count === 0) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleApiError(err, 'PATCH scan/documents')
  }
}
