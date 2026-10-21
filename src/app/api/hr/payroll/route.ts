import { requireAccess } from '@/lib/rbac'
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getPayrollSummary } from '@/services/hr'

// GET /api/hr/payroll?tenantId=&month=&year= (mois en cours par défaut)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')
    // Mois/année facultatifs : par défaut le mois en cours (la page ne doit jamais recevoir un 400)
    const now = new Date()
    const m = parseInt(searchParams.get('month') || '', 10)
    const y = parseInt(searchParams.get('year') || '', 10)
    const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : now.getMonth() + 1
    const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : now.getFullYear()

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:read')
    if (accessDenied) return accessDenied

    const summary = await getPayrollSummary(ctx.tenantId, month, year)
    return NextResponse.json(summary)
  } catch (err) {
    return handleApiError(err, 'GET payroll summary')
  }
}