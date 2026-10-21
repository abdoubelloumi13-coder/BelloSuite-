import { NextRequest, NextResponse } from 'next/server'
import { getProducts, createProduct } from '@/services/products'
import { createProductSchema, schemaDriftResponse, forbiddenStockAdmin } from '@/lib/stock-api'
import { handleApiError } from '@/lib/errors'
import { requirePermission, hasPermission, Permission } from '@/lib/auth'
import { requireTenant } from '@/lib/api-auth'
import { z } from 'zod'


// GET /api/stock/products?tenantId=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await requireTenant(req, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    requirePermission(ctx.userRole, Permission.READ_PRODUCT)
    const tenantId = ctx.tenantId

    const products = await getProducts(tenantId)
    return NextResponse.json(products)
  } catch (err) {
    return handleApiError(err, 'GET products')
  }
}

// POST /api/stock/products
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corps de requête JSON invalide' }, { status: 400 })
    const ctx = await requireTenant(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx
    // Auparavant requirePermission levait une Error générique → 500 « Internal Server Error » masqué côté client.
    if (!hasPermission(ctx.userRole, Permission.CREATE_PRODUCT)) return forbiddenStockAdmin('créer un article')

    let validatedData
    try {
      validatedData = createProductSchema.parse({ ...body, tenantId: ctx.tenantId })
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        return NextResponse.json({ error: 'Données invalides', details: validationError.issues }, { status: 400 })
      }
      throw validationError
    }

    // Le tenant vient toujours de la session
    validatedData = { ...validatedData, tenantId: ctx.tenantId }

    const product = await createProduct(validatedData, ctx.user.id)
    return NextResponse.json(product, { status: 201 })
  } catch (err) {
    return schemaDriftResponse(err) ?? handleApiError(err, 'POST product')
  }
}
