import { requireAccess } from '@/lib/rbac'
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getChartOfAccounts, initChartOfAccounts, syncTunisianChartOfAccounts } from '@/services/accounting'

// GET /api/accounting/chart
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    // Tenants existants : compléter les comptes ajoutés au modèle tunisien (431, 4368, 4371…)
    await syncTunisianChartOfAccounts(ctx.tenantId).catch(e => console.error('Chart sync error:', e))
    let accounts = await getChartOfAccounts(ctx.tenantId)

    // Auto-init if empty
    if (accounts.length === 0) {
      await initChartOfAccounts(ctx.tenantId)
      accounts = await getChartOfAccounts(ctx.tenantId)
    }

    return NextResponse.json(accounts)
  } catch (err) {
    return handleApiError(err, 'GET accounting chart')
  }
}

// POST /api/accounting/chart/init (Manual init)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'accounting:write')
    if (accessDenied) return accessDenied

    await initChartOfAccounts(ctx.tenantId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleApiError(err, 'POST accounting init')
  }
}
