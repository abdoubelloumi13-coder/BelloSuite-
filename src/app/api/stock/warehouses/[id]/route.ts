import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { updateWarehouse, updateWarehouseSchema, deleteWarehouse } from '@/services/stock'
import { isStockAdmin, forbidden, readJson, str, schemaDriftResponse, forbiddenStockAdmin } from '@/lib/stock-api'
import { valuationCost, stockValue, isLowStock, round3 } from '@/lib/stock-logic'

type Params = { params: Promise<{ id: string }> }

// GET /api/stock/warehouses/:id → dépôt + stock par produit
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx

    const wh = await prisma.warehouse.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: {
        productStock: {
          include: { product: { select: { id: true, code: true, name: true, category: true, unit: true, averageCost: true, purchasePrice: true, minStock: true, reorderPoint: true } } },
          orderBy: { product: { code: 'asc' } },
        },
      },
    })
    if (!wh) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const { productStock, ...warehouse } = wh
    const lines = productStock.map(pw => {
      const cost = valuationCost(Number(pw.product.averageCost), Number(pw.product.purchasePrice))
      const qty = Number(pw.stock)
      const min = pw.minStock !== null ? Number(pw.minStock) : Number(pw.product.minStock)
      return {
        productId: pw.productId,
        code: pw.product.code,
        name: pw.product.name,
        category: pw.product.category,
        unit: pw.product.unit,
        stock: round3(qty),
        minStock: pw.minStock !== null ? Number(pw.minStock) : null,
        effectiveMin: min,
        unitCost: cost,
        value: stockValue(qty, cost),
        low: isLowStock(qty, min),
      }
    })
    return NextResponse.json({
      ...warehouse,
      lines,
      totalQty: round3(lines.reduce((s, l) => s + l.stock, 0)),
      totalValue: round3(lines.reduce((s, l) => s + l.value, 0)),
    })
  } catch (err) {
    return handleApiError(err, 'GET warehouse')
  }
}

// PUT /api/stock/warehouses/:id  (modification, archivage via isActive=false, dépôt par défaut)
export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const body = await readJson(req)
    const ctx = await getApiContext(req, str(body.tenantId))
    if (ctx instanceof NextResponse) return ctx
    if (!isStockAdmin(ctx)) return forbiddenStockAdmin('modifier un dépôt')

    const data = parseBody(updateWarehouseSchema, body)
    if (data instanceof NextResponse) return data
    const updated = await updateWarehouse(ctx.tenantId, id, data)
    return NextResponse.json(updated)
  } catch (err) {
    return schemaDriftResponse(err) ?? handleApiError(err, 'PUT warehouse')
  }
}

// DELETE /api/stock/warehouses/:id  (uniquement un dépôt vierge ; sinon 409 → archiver)
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    if (!isStockAdmin(ctx)) return forbidden()
    return NextResponse.json(await deleteWarehouse(ctx.tenantId, id))
  } catch (err) {
    return handleApiError(err, 'DELETE warehouse')
  }
}
