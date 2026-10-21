import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getWarehouses, createWarehouse, createWarehouseSchema, ensureDefaultWarehouseId } from '@/services/stock'
import { isStockAdmin, readJson, str, schemaDriftResponse, forbiddenStockAdmin } from '@/lib/stock-api'

// GET /api/stock/warehouses?includeArchived=1
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await getApiContext(req, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx

    // Tenant sans aucun dépôt : création automatique d'un « Dépôt principal » (sinon mouvements,
    // inventaires et POS restent bloqués). Un échec ici ne doit pas empêcher la lecture de la liste.
    try { await ensureDefaultWarehouseId(ctx.tenantId) } catch (e) { console.warn('[warehouses] dépôt principal non créé :', (e as Error)?.message) }

    const warehouses = await getWarehouses(ctx.tenantId, { includeArchived: searchParams.get('includeArchived') === '1' })
    return NextResponse.json(warehouses)
  } catch (err) {
    return schemaDriftResponse(err) ?? handleApiError(err, 'GET warehouses')
  }
}

// POST /api/stock/warehouses
export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req)
    const ctx = await getApiContext(req, str(body.tenantId))
    if (ctx instanceof NextResponse) return ctx
    if (!isStockAdmin(ctx)) return forbiddenStockAdmin('créer un dépôt')

    const data = parseBody(createWarehouseSchema, { ...body, tenantId: ctx.tenantId })
    if (data instanceof NextResponse) return data

    const warehouse = await createWarehouse({ ...data, tenantId: ctx.tenantId })
    return NextResponse.json(warehouse, { status: 201 })
  } catch (err) {
    return schemaDriftResponse(err) ?? handleApiError(err, 'POST warehouse')
  }
}
