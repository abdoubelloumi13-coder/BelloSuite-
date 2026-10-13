import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError, BusinessError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { isStockAdmin, forbidden, readJson, str, unitSchema } from '@/lib/stock-api'

/** Unités proposées par défaut (créées au premier accès si le tenant n'en a aucune). */
const DEFAULT_UNITS = [
  { code: 'pcs', name: 'Pièce', decimals: 0 },
  { code: 'kg', name: 'Kilogramme', decimals: 3 },
  { code: 'g', name: 'Gramme', decimals: 0 },
  { code: 'm', name: 'Mètre', decimals: 2 },
  { code: 'm2', name: 'Mètre carré', decimals: 2 },
  { code: 'l', name: 'Litre', decimals: 3 },
  { code: 'box', name: 'Boîte', decimals: 0 },
  { code: 'ft', name: 'Pied', decimals: 2 },
]

export async function GET(req: NextRequest) {
  try {
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    let units = await prisma.stockUnit.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { code: 'asc' } })
    if (units.length === 0) {
      await prisma.stockUnit.createMany({ data: DEFAULT_UNITS.map(u => ({ ...u, tenantId: ctx.tenantId })), skipDuplicates: true })
      units = await prisma.stockUnit.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { code: 'asc' } })
    }
    const used = await prisma.product.groupBy({ by: ['unit'], where: { tenantId: ctx.tenantId }, _count: { _all: true } })
    const counts = new Map(used.map(u => [u.unit, u._count._all]))
    return NextResponse.json(units.map(u => ({ ...u, productCount: counts.get(u.code) ?? 0 })))
  } catch (err) {
    return handleApiError(err, 'GET units')
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await readJson(req)
    const ctx = await getApiContext(req, str(body.tenantId))
    if (ctx instanceof NextResponse) return ctx
    if (!isStockAdmin(ctx)) return forbidden()
    const data = parseBody(unitSchema, body)
    if (data instanceof NextResponse) return data
    const dup = await prisma.stockUnit.findFirst({ where: { tenantId: ctx.tenantId, code: data.code }, select: { id: true } })
    if (dup) throw new BusinessError('Unité déjà existante', 409)
    const unit = await prisma.stockUnit.create({ data: { ...data, tenantId: ctx.tenantId } })
    return NextResponse.json(unit, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST unit')
  }
}
