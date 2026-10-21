import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'

// GET /api/pos/products?q=&limit=
// Recherche côté serveur (nom, code, code-barres) : tout le catalogue est atteignable, pas seulement les
// 200 premiers articles chargés. Réponse : { data, total, hasMore }.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await getApiContext(req, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx

    const q = (searchParams.get('q') || '').trim().slice(0, 100)
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 60))
    const where = {
      tenantId: ctx.tenantId,
      isActive: true,
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { code: { contains: q, mode: 'insensitive' as const } },
        { barcode: { contains: q, mode: 'insensitive' as const } },
        { category: { contains: q, mode: 'insensitive' as const } },
      ] } : {}),
    }
    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: { id: true, code: true, barcode: true, name: true, category: true, unit: true, salePrice: true, vatRate: true, currentStock: true },
        take: limit,
        orderBy: { name: 'asc' },
      }),
      prisma.product.count({ where }),
    ])
    // Code-barres scanné exact en tête
    if (q) data.sort((a, b) => Number(b.barcode === q || b.code === q) - Number(a.barcode === q || a.code === q))
    return NextResponse.json({ data, total, hasMore: total > data.length })
  } catch (err) {
    return handleApiError(err, 'GET pos products search')
  }
}
