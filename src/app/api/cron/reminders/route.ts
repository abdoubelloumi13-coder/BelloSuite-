/**
 * POST /api/cron/reminders
 * Called by n8n (or any cron) every day at 8h AM.
 * Body: { tenantId, overdueDaysThreshold?, methods?, intervalDays? }
 * Or: GET /api/cron/reminders?tenantId=   (sans tenantId : tous les tenants actifs — Vercel Cron)
 *
 * SÉCURITÉ : en-tête obligatoire `Authorization: Bearer <CRON_SECRET>` (format Vercel Cron)
 * ou `x-cron-secret: <CRON_SECRET>`. Plus de secret dans l'URL.
 *
 * Déduplication (voir src/lib/reminder-logic.ts) : une facture n'est relancée qu'une fois par intervalle
 * (défaut 7 j, `intervalDays`), sur UN canal (le premier joignable de `methods`, les suivants en repli
 * si échec). Sans fournisseur configuré ou pour le tenant de démo : statut « simulated » (rien n'est envoyé).
 * Chaque tenant est isolé (try/catch) ; arrêt propre avant maxDuration.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sendAutoReminders, type ReminderMethod } from '@/lib/reminder-service'
import { checkCronSecret } from '@/lib/api-auth'
import { DEFAULT_REMINDER_INTERVAL_DAYS } from '@/lib/reminder-logic'

export const runtime = 'nodejs'
export const maxDuration = 60
/** Marge laissée avant maxDuration pour répondre */
const BUDGET_MS = (maxDuration - 10) * 1000

const VALID: ReminderMethod[] = ['EMAIL', 'SMS', 'WHATSAPP']

function parseOpts(src: { overdueDaysThreshold?: unknown; methods?: unknown; intervalDays?: unknown }) {
  const methods = Array.isArray(src.methods) ? (src.methods.filter(m => VALID.includes(m as ReminderMethod)) as ReminderMethod[]) : []
  const overdue = Number(src.overdueDaysThreshold)
  const interval = Number(src.intervalDays)
  return {
    overdueDaysThreshold: Number.isFinite(overdue) && overdue >= 0 ? overdue : 1,
    methods: methods.length ? methods : (['EMAIL', 'WHATSAPP'] as ReminderMethod[]),
    intervalDays: Number.isFinite(interval) && interval >= 1 ? interval : DEFAULT_REMINDER_INTERVAL_DAYS,
  }
}

async function runForTenants(tenantIds: string[], opts: ReturnType<typeof parseOpts>) {
  const deadline = Date.now() + BUDGET_MS
  const summary: Array<Record<string, unknown>> = []
  for (const tenantId of tenantIds) {
    if (Date.now() > deadline) { summary.push({ tenantId, status: 'skipped', error: 'durée maximale atteinte' }); continue }
    try {
      const r = await sendAutoReminders(tenantId, { ...opts, deadline })
      summary.push({ tenantId, status: 'ok', ...r })
    } catch (e) {
      console.error('[cron reminders] tenant', tenantId, e)
      summary.push({ tenantId, status: 'error', error: (e as Error)?.message || 'erreur' })
    }
  }
  return summary
}

export async function POST(req: NextRequest) {
  const denied = checkCronSecret(req)
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : ''
    if (!tenantId) return NextResponse.json({ error: 'tenantId requis' }, { status: 400 })
    const [one] = await runForTenants([tenantId], parseOpts(body || {}))
    return NextResponse.json({ success: one.status === 'ok', ...one, at: new Date().toISOString() }, { status: one.status === 'error' ? 500 : 200 })
  } catch (e) {
    console.error('cron reminders error:', e)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  const denied = checkCronSecret(req)
  if (denied) return denied
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')
    const opts = parseOpts({
      intervalDays: searchParams.get('intervalDays') ?? undefined,
      methods: searchParams.get('methods')?.split(',').map(s => s.trim().toUpperCase()),
    })
    const ids = tenantId ? [tenantId] : (await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } })).map(t => t.id)
    const summary = await runForTenants(ids, opts)
    if (tenantId) return NextResponse.json({ success: summary[0]?.status === 'ok', ...summary[0], at: new Date().toISOString() })
    return NextResponse.json({ summary, at: new Date().toISOString() })
  } catch (e) {
    console.error('cron reminders error:', e)
    return NextResponse.json({ error: 'Erreur interne' }, { status: 500 })
  }
}
