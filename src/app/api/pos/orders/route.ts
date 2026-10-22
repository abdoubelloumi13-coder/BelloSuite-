import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { createPOSOrder, posOrderSchema } from '@/services/pos'

// POST /api/pos/orders — { sessionId, orderNumber?, items[], payments[{ method, amount }], discountPercent }
// Totaux recalculés côté serveur (remise sur HT puis TVA ; timbre selon réglage caisse, défaut non).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corps de requête JSON invalide' }, { status: 400 })
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    const data = parseBody(posOrderSchema, { ...body, tenantId: ctx.tenantId })
    if (data instanceof NextResponse) return data

    const order = await createPOSOrder(data)
    return NextResponse.json(order, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST pos order')
  }
}