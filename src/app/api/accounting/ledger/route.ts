import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getGeneralLedger } from '@/services/accounting'

// GET /api/accounting/ledger?startDate|from=&endDate|to=&periodId=&accountId=
// Renvoie toujours { accounts: [], totalDebit, totalCredit, isBalanced, startDate, endDate }
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await getApiContext(req, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx

    const ledger = await getGeneralLedger(ctx.tenantId, {
      startDate: searchParams.get('startDate') || searchParams.get('from') || undefined,
      endDate: searchParams.get('endDate') || searchParams.get('to') || undefined,
      accountId: searchParams.get('accountId') || undefined,
      periodId: searchParams.get('periodId') || undefined,
    })
    return NextResponse.json(ledger)
  } catch (err) {
    return handleApiError(err, 'GET general ledger')
  }
}
