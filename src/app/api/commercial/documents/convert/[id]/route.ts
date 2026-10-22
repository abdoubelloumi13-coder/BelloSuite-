import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { convertDocument } from '@/services/invoices'
import { z } from 'zod'

const convertSchema = z.object({
  tenantId: z.string().min(1).optional(),
  /** QUOTE → ORDER|INVOICE, ORDER → DELIVERY_NOTE|INVOICE, DELIVERY_NOTE → INVOICE, INVOICE → CREDIT_NOTE */
  targetType: z.string().min(1).optional().nullable(),
  /** Conversion en bon de livraison : dépôt de sortie (défaut : dépôt par défaut du tenant). */
  warehouseId: z.string().min(1).optional().nullable(),
})

// POST /api/commercial/documents/convert/:id
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json().catch(() => ({}))
    const validated = convertSchema.safeParse(body)
    
    if (!validated.success) {
      return NextResponse.json({ error: 'Données invalides', details: validated.error.issues }, { status: 400 })
    }

    const ctx = await getApiContext(req, validated.data.tenantId)
    if (ctx instanceof NextResponse) return ctx

    const { id } = await params
    const converted = await convertDocument(id, ctx.tenantId, validated.data.targetType, {
      warehouseId: validated.data.warehouseId,
      userId: ctx.user?.id ?? null,
    })

    return NextResponse.json(converted, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'CONVERT document')
  }
}
