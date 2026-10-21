import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { tenantRefsError } from '@/lib/tenant-scope'
import { resolveDeliveryWarehouseTx, postDeliveryNoteStockTx } from '@/services/delivery-notes'
import { handleApiError } from '@/lib/errors'

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

export async function POST(request: Request) {
  try {
    let body: Record<string, any>
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
    }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
    const { 
      tenantId: requestedTenantId, 
      clientId, 
      number, 
      date, 
      dueDate, 
      items, 
      subtotalHT, 
      totalFodec, 
      totalVAT, 
      timbreFiscal, 
      totalTTC, 
      vatSummary,
      notes,
      type,
      warehouseId: requestedWarehouseId,
    } = body
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId || !clientId || !number || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
    }
    if (items.some((i: { quantity?: unknown }) => !Number.isFinite(Number(i?.quantity)) || Number(i?.quantity) < 0)) {
      return NextResponse.json({ error: 'Quantité invalide' }, { status: 400 })
    }
    const docType = typeof type === 'string' && type ? type : 'INVOICE'
    if (requestedWarehouseId != null && typeof requestedWarehouseId !== 'string') {
      return NextResponse.json({ error: 'Référence invalide (warehouse)', code: 'WAREHOUSE_INVALID' }, { status: 400 })
    }
    const duplicate = await prisma.invoice.findFirst({ where: { tenantId, type: docType, number: String(number) }, select: { id: true } })
    if (duplicate) {
      return NextResponse.json({ error: `Numéro "${number}" déjà utilisé` }, { status: 409 })
    }
    const badRef = await tenantRefsError(tenantId, {
      client: clientId,
      product: items.map((i: { productId?: string }) => i.productId),
    })
    if (badRef) return badRef

    // Use a transaction to ensure all operations succeed or none do
    const result = await prisma.$transaction(async (tx) => {
      // Pratique tunisienne : seul le bon de livraison (BL) sort la marchandise du stock.
      // La facture est un document commercial/fiscal : elle peut précéder la livraison
      // (client qui paie avant d'être livré) et ne touche donc jamais au stock.
      const isDeliveryNote = docType === 'DELIVERY_NOTE'
      const delivery = isDeliveryNote
        ? await resolveDeliveryWarehouseTx(tx, tenantId, requestedWarehouseId)
        : null

      const invoice = await tx.invoice.create({
        data: {
          tenantId,
          clientId,
          number,
          type: docType,
          warehouseId: delivery?.warehouseId ?? null,
          status: 'PENDING',
          date: new Date(date),
          dueDate: dueDate ? new Date(dueDate) : null,
          subtotalHT,
          totalFodec,
          totalVAT,
          timbreFiscal,
          totalTTC,
          vatSummary: vatSummary || {},
          notes,
          items: {
            create: items.map((item: any) => ({
              productId: item.productId || null,
              description: item.description,
              quantity: Number(item.quantity),
              unitPriceHT: Number(item.unitPriceHT),
              discount: Number(item.discount) || 0,
              fodecApply: item.fodecApply || false,
              fodecAmount: Number(item.fodecAmount) || 0,
              vatRate: Number.isFinite(Number(item.vatRate)) && item.vatRate !== '' && item.vatRate != null ? Number(item.vatRate) : 19,
              vatAmount: Number(item.vatAmount) || 0,
              totalHT: Number(item.totalHT) || 0,
              totalTTC: Number(item.totalTTC) || 0,
            })),
          },
        },
        include: {
          items: true,
        },
      })

      // Sortie de stock dans le dépôt choisi ; refus (409) si stock insuffisant et stock négatif non autorisé.
      if (delivery?.stockEnabled) {
        await postDeliveryNoteStockTx(tx, {
          tenantId,
          invoiceId: invoice.id,
          number: String(number),
          warehouseId: delivery.warehouseId,
          lines: items,
          userId: ctx.user.id,
        })
      }

      return invoice
    })

    return NextResponse.json(result)
  } catch (error) {
    return handleApiError(error, 'POST commercial document')
  }
}
