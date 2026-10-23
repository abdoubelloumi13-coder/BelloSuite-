/** POST /api/accounting/periods/:id/reopen — réservé à l'administrateur de l'entreprise. */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { requireTenantRole } from '@/lib/rbac'
import { reopenFiscalYear } from '@/services/fiscal-close'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireTenantRole(ctx, ['ADMIN'])
    if (denied) return denied
    const { id } = await params
    return NextResponse.json(await reopenFiscalYear(ctx.tenantId, id))
  } catch (err) {
    return handleApiError(err, 'reopen fiscal year')
  }
}
