import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { sendReminder } from '@/services/treasury'
import { denyDemo } from '@/lib/rbac'

// POST /api/commercial/payments/:id/remind
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const body = await req.json()
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx
    // Démo publique : pas de relance sortante
    const demoDenied = denyDemo(ctx)
    if (demoDenied) return demoDenied

    const { id } = await params
    const result = await sendReminder(id, ctx.tenantId, body.method || 'EMAIL')

    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    return handleApiError(err, 'POST reminder')
  }
}
