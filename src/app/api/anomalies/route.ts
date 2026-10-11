/**
 * GET /api/anomalies?status=OPEN|IGNORED|RESOLVED&limit= — anomalies du tenant de la session.
 * Réponse : { items, counts, lastRun, tableMissing? } ; tableMissing=true si la migration n'est pas appliquée.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { isMissingTableError, listAnomalies } from '@/services/anomalies'
import type { AnomalyStatus } from '@/lib/anomalies'

export const dynamic = 'force-dynamic'
const STATUSES: AnomalyStatus[] = ['OPEN', 'IGNORED', 'RESOLVED']

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await getApiContext(req, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const s = (searchParams.get('status') || 'OPEN').toUpperCase() as AnomalyStatus
    const status = STATUSES.includes(s) ? s : 'OPEN'
    const limit = Number(searchParams.get('limit')) || 200
    try {
      return NextResponse.json(await listAnomalies(ctx.tenantId, status, limit))
    } catch (e) {
      if (isMissingTableError(e)) return NextResponse.json({ items: [], counts: { OPEN: 0, IGNORED: 0, RESOLVED: 0 }, lastRun: null, tableMissing: true })
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'anomalies')
  }
}
