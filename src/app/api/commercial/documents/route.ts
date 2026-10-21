import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleApiError } from '@/lib/errors'
import { createInvoice, createInvoiceSchema } from '@/services/invoices'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
    }

    const type = searchParams.get('type')
    const invoices = await prisma.invoice.findMany({
      where: { tenantId, ...(type ? { type } : {}) },
      include: {
        client: true,
        items: true,
        tenant: true,
        warehouse: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(invoices)
  } catch (error) {
    console.error('Error fetching invoices:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

/**
 * POST /api/commercial/documents — création d'un document de vente.
 * Montants recalculés côté serveur, numéro légal attribué à l'enregistrement (le `number` et les
 * totaux envoyés par le client sont ignorés). Voir services/invoices#createInvoice.
 */
export async function POST(request: Request) {
  try {
    let body: Record<string, any>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
    }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
    const ctx = await requireTenant(request, body.tenantId)
    if (ctx instanceof NextResponse) return ctx

    if (body.warehouseId != null && typeof body.warehouseId !== 'string') {
      return NextResponse.json({ error: 'Référence invalide (warehouse)', code: 'WAREHOUSE_INVALID' }, { status: 400 })
    }
    // Lignes totalement vides (ni produit, ni désignation, ni prix) ignorées
    const items = Array.isArray(body.items)
      ? body.items.filter((i: any) => i && (i.productId || String(i.description ?? '').trim() || Number(i.unitPriceHT) > 0))
      : body.items
    const parsed = createInvoiceSchema.safeParse({
      ...body,
      items,
      tenantId: ctx.tenantId,
      type: typeof body.type === 'string' && body.type ? body.type : 'INVOICE',
      vatExemption: body.vatExemption || null,
      originalInvoiceId: body.originalInvoiceId || null,
      warehouseId: body.warehouseId || null,
    })
    if (!parsed.success) {
      return NextResponse.json({ error: 'Données invalides', details: parsed.error.issues }, { status: 400 })
    }
    const result = await createInvoice(parsed.data, { userId: ctx.user?.id ?? null })
    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, 'POST commercial document')
  }
}
