/** PATCH /api/anomalies/:id { status: 'IGNORED' | 'RESOLVED' | 'OPEN' } — tenant de la session uniquement. */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { setAnomalyStatus } from '@/services/anomalies'

const schema = z.object({ status: z.enum(['IGNORED', 'RESOLVED', 'OPEN']) })

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    const data = parseBody(schema, await req.json().catch(() => null))
    if (data instanceof NextResponse) return data
    const updated = await setAnomalyStatus(ctx.tenantId, id, data.status, ctx.user.id || null)
    if (!updated) return NextResponse.json({ error: 'Anomalie introuvable' }, { status: 404 })
    return NextResponse.json({ id: updated.id, status: updated.status })
  } catch (error) {
    return handleApiError(error, 'anomalies')
  }
}
