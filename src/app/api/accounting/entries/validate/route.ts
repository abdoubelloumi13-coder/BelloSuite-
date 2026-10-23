/** POST /api/accounting/entries/validate { ids: string[] } — valide des écritures brouillon équilibrées. */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { requireAccess } from '@/lib/rbac'
import { validateEntries } from '@/services/fiscal-close'

const schema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) })

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'accounting:write')
    if (denied) return denied
    const data = parseBody(schema, await req.json().catch(() => null))
    if (data instanceof NextResponse) return data
    return NextResponse.json(await validateEntries(ctx.tenantId, data.ids))
  } catch (err) {
    return handleApiError(err, 'validate journal entries')
  }
}
