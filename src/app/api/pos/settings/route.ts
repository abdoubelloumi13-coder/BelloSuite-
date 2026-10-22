import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getPosSettings, updatePosSettings } from '@/services/pos'

// GET /api/pos/settings — { applyStamp, stampAmount } (timbre désactivé par défaut)
export async function GET(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json(await getPosSettings(ctx.tenantId))
  } catch (err) {
    return handleApiError(err, 'GET pos settings')
  }
}

// PUT /api/pos/settings — réservé aux administrateurs
export async function PUT(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    if (ctx.userRole !== 'ADMIN' && ctx.userRole !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Droits insuffisants : seul un administrateur peut modifier les réglages de caisse.' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({})) as { applyStamp?: unknown; stampAmount?: unknown }
    return NextResponse.json(await updatePosSettings(ctx.tenantId, {
      applyStamp: typeof body.applyStamp === 'boolean' ? body.applyStamp : undefined,
      stampAmount: body.stampAmount !== undefined ? Number(body.stampAmount) : undefined,
    }))
  } catch (err) {
    return handleApiError(err, 'PUT pos settings')
  }
}
