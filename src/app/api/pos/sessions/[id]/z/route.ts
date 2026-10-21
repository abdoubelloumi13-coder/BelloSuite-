import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getZReport } from '@/services/pos'

// GET /api/pos/sessions/[id]/z — rapport Z (session fermée) ou X (session encore ouverte)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    return NextResponse.json(await getZReport(ctx.tenantId, id))
  } catch (err) {
    return handleApiError(err, 'GET pos z-report')
  }
}
