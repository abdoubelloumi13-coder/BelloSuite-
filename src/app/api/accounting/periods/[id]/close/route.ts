/**
 * GET  /api/accounting/periods/:id/close — aperçu (blocages, résultat, écriture de clôture).
 * POST /api/accounting/periods/:id/close — clôture l'exercice.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { requireAccess } from '@/lib/rbac'
import { getClosingPreview, closeFiscalYear } from '@/services/fiscal-close'

type P = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: P) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    return NextResponse.json(await getClosingPreview(ctx.tenantId, id))
  } catch (err) {
    return handleApiError(err, 'closing preview')
  }
}

export async function POST(req: NextRequest, { params }: P) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'accounting:write')
    if (denied) return denied
    const { id } = await params
    return NextResponse.json(await closeFiscalYear(ctx.tenantId, id))
  } catch (err) {
    return handleApiError(err, 'close fiscal year')
  }
}
