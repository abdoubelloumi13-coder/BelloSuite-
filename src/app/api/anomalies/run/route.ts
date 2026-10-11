/**
 * POST /api/anomalies/run — analyse immédiate du tenant de la session (ADMIN / SUPER_ADMIN), sans email.
 * Limitée à 10 analyses / heure / tenant.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { rateLimitPersistent, tooManyRequests } from '@/lib/rate-limit-persistent'
import { isMissingTableError, runTenantAnomalies } from '@/services/anomalies'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    if (ctx.userRole !== 'ADMIN' && ctx.userRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    const rl = await rateLimitPersistent(`anomalies-run:tenant:${ctx.tenantId}`, 10, 3600)
    if (!rl.success) return tooManyRequests(rl)
    try {
      const r = await runTenantAnomalies(ctx.tenantId, { trigger: 'MANUAL', sendEmail: false })
      if (!r) return NextResponse.json({ error: 'Entreprise introuvable' }, { status: 404 })
      return NextResponse.json({ detected: r.detected, created: r.created, autoResolved: r.autoResolved, open: r.open, errors: r.errors })
    } catch (e) {
      if (isMissingTableError(e)) return NextResponse.json({ error: 'Migration non appliquée', code: 'ANOMALY_TABLES_MISSING' }, { status: 503 })
      throw e
    }
  } catch (error) {
    return handleApiError(error, 'anomalies')
  }
}
