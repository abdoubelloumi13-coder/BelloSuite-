/**
 * GET|POST /api/cron/anomalies — détection nocturne des anomalies + email matinal « N points à vérifier ».
 *
 * SÉCURITÉ : `Authorization: Bearer <CRON_SECRET>` (format Vercel Cron) ou `x-cron-secret: <CRON_SECRET>`.
 * Planification (gratuite, au choix) :
 *  - Vercel Cron (vercel.json) : tous les jours 05:00 UTC = 06:00 heure de Tunis ;
 *  - ou Supabase pg_cron + pg_net : supabase/snippets/anomalies_pg_cron.sql (plusieurs appels → reprise).
 * Traite par lots les tenants actifs pas encore analysés aujourd'hui (budget ~40 s), 1 seule exécution
 * planifiée par tenant et par jour (verrou "AnomalyRun"(tenantId, cronDay)) → jamais deux emails le même jour.
 * Paramètres optionnels : ?tenantId=… (un seul tenant), ?email=0 (pas d'email).
 */
import { NextResponse } from 'next/server'
import { checkCronSecret } from '@/lib/api-auth'
import { isMissingTableError, runAnomalyCronBatch } from '@/services/anomalies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function handle(req: Request) {
  const denied = checkCronSecret(req)
  if (denied) return denied
  const { searchParams } = new URL(req.url)
  try {
    const result = await runAnomalyCronBatch({
      tenantId: searchParams.get('tenantId'),
      sendEmail: searchParams.get('email') !== '0',
      budgetMs: 40_000,
    })
    return NextResponse.json({ success: true, ...result, at: new Date().toISOString() })
  } catch (e) {
    if (isMissingTableError(e)) {
      return NextResponse.json({ error: 'Migration 20261011050000_anomalies.sql non appliquée', code: 'ANOMALY_TABLES_MISSING' }, { status: 503 })
    }
    console.error('[cron anomalies]', e)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
