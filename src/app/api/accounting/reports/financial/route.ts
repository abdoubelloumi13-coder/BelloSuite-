/**
 * GET /api/accounting/reports/financial?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Bilan (cumulatif, arrêté à `to`) et état de résultat (de `from` à `to`), modèle tunisien NC 01.
 * Sans dates : exercice en cours (ou année civile).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { parseDateParam } from '@/lib/ledger'
import { getFinancialStatements } from '@/services/fiscal-close'

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams
    const ctx = await getApiContext(req, sp.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx

    let from = parseDateParam(sp.get('from'))
    let to = parseDateParam(sp.get('to'))
    if (!from || !to) {
      const now = new Date()
      const period = await prisma.accountingPeriod.findFirst({
        where: { tenantId: ctx.tenantId, startDate: { lte: now }, endDate: { gte: now } },
        orderBy: { startDate: 'desc' },
      })
      from = from ?? period?.startDate ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
      to = to ?? period?.endDate ?? new Date(Date.UTC(now.getUTCFullYear(), 11, 31))
    }
    if (from > to) return NextResponse.json({ error: 'La date de début dépasse la date de fin' }, { status: 400 })
    return NextResponse.json(await getFinancialStatements(ctx.tenantId, { from, to }))
  } catch (err) {
    return handleApiError(err, 'financial statements')
  }
}
