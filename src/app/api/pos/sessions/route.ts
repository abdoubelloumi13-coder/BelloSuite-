import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getSessions, getCurrentOpenSession, openSession, openSessionSchema } from '@/services/pos'

// GET /api/pos/sessions
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    // ?current=1 → la dernière session OUVERTE (ou null) ; ?status=OPEN|CLOSED → filtre (avant : ignoré,
    // la caisse reprenait la session la plus récente même fermée)
    if (searchParams.get('current') === '1') {
      return NextResponse.json(await getCurrentOpenSession(ctx.tenantId))
    }
    const st = searchParams.get('status')
    const sessions = await getSessions(ctx.tenantId, { status: st === 'OPEN' || st === 'CLOSED' ? st : undefined })
    return NextResponse.json(sessions)
  } catch (err) {
    return handleApiError(err, 'GET pos sessions')
  }
}

// POST /api/pos/sessions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    const u = ctx.user as { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }
    const userName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || String(body?.userName || 'Caissier')
    const data = parseBody(openSessionSchema, { ...body, tenantId: ctx.tenantId, userId: ctx.user.id, userName })
    if (data instanceof NextResponse) return data

    const session = await openSession(data)
    return NextResponse.json(session, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST pos sessions')
  }
}
