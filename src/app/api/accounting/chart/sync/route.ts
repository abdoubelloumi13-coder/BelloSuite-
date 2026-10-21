import { requireAccess } from '@/lib/rbac'
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { syncTunisianChartOfAccounts } from '@/services/accounting'

// POST /api/accounting/chart/sync — « Compléter le plan comptable tunisien » (idempotent)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const ctx = await getApiContext(req, body?.tenantId ?? new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'accounting:write')
    if (accessDenied) return accessDenied
    return NextResponse.json(await syncTunisianChartOfAccounts(ctx.tenantId, { evenIfEmpty: true }))
  } catch (err) {
    return handleApiError(err, 'POST accounting chart sync')
  }
}
