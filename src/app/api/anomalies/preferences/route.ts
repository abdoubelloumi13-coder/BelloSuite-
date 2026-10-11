/** GET|PUT /api/anomalies/preferences { emailOptOut: boolean } — désinscription de l'email matinal (utilisateur courant). */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getEmailOptOut, setEmailOptOut } from '@/services/anomalies'

const schema = z.object({ emailOptOut: z.boolean() })

export async function GET(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json({ emailOptOut: await getEmailOptOut(ctx.tenantId, ctx.user.id), isAdmin: ctx.userRole === 'ADMIN' || ctx.userRole === 'SUPER_ADMIN' })
  } catch (error) {
    return handleApiError(error, 'anomalies')
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const data = parseBody(schema, await req.json().catch(() => null))
    if (data instanceof NextResponse) return data
    return NextResponse.json({ emailOptOut: await setEmailOptOut(ctx.tenantId, ctx.user.id, data.emailOptOut) })
  } catch (error) {
    return handleApiError(error, 'anomalies')
  }
}
