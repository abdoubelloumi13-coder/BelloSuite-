/**
 * Anomalies nocturnes : chargement des données d'un tenant, détection (lib pure), stockage, email matinal.
 * Utilisé par /api/cron/anomalies (planifié) et /api/anomalies/* (interface).
 */
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import {
  DEFAULT_ANOMALY_CONFIG,
  detectAnomalies,
  pickTop,
  reconcileStatus,
  resolveAnomalyConfig,
  type AnomalyConfig,
  type AnomalySnapshot,
  type AnomalyStatus,
  type DetectedAnomaly,
} from '@/lib/anomalies'
import { purchaseDocType } from '@/lib/purchase-logic'
import { buildAnomalyEmail, tenantLocale } from '@/lib/anomaly-email'
import { selectMailProvider, sendMail } from '@/lib/mailer'

const DAY = 86_400_000
const n = (v: unknown) => Number(v ?? 0) || 0

/** Tables absentes (migration non appliquée) → erreur Prisma P2021 / P2022. */
export function isMissingTableError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2021' || e.code === 'P2022')
}

/** Jour calendaire à Tunis (AAAA-MM-JJ) — clé de l'exécution planifiée quotidienne. */
export function tunisDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Charge l'instantané d'un tenant (documents récents + historique fournisseur 1 an + produits). */
export async function loadAnomalySnapshot(tenantId: string, now: Date, cfg: AnomalyConfig = DEFAULT_ANOMALY_CONFIG): Promise<AnomalySnapshot> {
  const since = new Date(now.getTime() - Math.max(400, cfg.windowDays * 3) * DAY)
  const [sales, unpaidOld, purchases, products, negWh] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, date: { gte: since }, type: { in: ['INVOICE', 'DELIVERY_NOTE', 'CREDIT_NOTE'] } },
      select: {
        id: true, number: true, type: true, status: true, date: true, dueDate: true,
        subtotalHT: true, totalFodec: true, totalVAT: true, timbreFiscal: true, totalTTC: true,
        currency: true, convertedFromId: true, client: { select: { name: true } },
        items: { select: { productId: true, description: true, quantity: true, unitPriceHT: true, discount: true, vatRate: true } },
      },
      orderBy: { date: 'asc' },
      take: 20000,
    }),
    // Impayés plus anciens que la fenêtre de chargement (relances)
    prisma.invoice.findMany({
      where: { tenantId, type: 'INVOICE', date: { lt: since }, status: { in: ['PENDING', 'SUBMITTED', 'CONFIRMED', 'SENT', 'ACCEPTED'] } },
      select: {
        id: true, number: true, type: true, status: true, date: true, dueDate: true,
        subtotalHT: true, totalFodec: true, totalVAT: true, timbreFiscal: true, totalTTC: true,
        currency: true, convertedFromId: true, client: { select: { name: true } },
      },
      take: 5000,
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, date: { gte: new Date(now.getTime() - 400 * DAY) } },
      select: {
        id: true, number: true, type: true, status: true, supplierId: true, supplierRef: true, date: true,
        subtotal: true, taxRate: true, taxAmount: true, total: true, linkedOrderId: true,
        supplier: { select: { name: true } },
        receipts: { where: { status: 'VALIDATED' }, select: { validatedAt: true, date: true } },
      },
      take: 20000,
    }),
    prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, code: true, name: true, currentStock: true, averageCost: true },
    }),
    prisma.productWarehouse.findMany({
      where: { stock: { lt: 0 }, product: { tenantId } },
      select: { productId: true, stock: true, warehouse: { select: { name: true } } },
    }),
  ])

  const negByProduct = new Map<string, { name: string; stock: number }[]>()
  for (const w of negWh) negByProduct.set(w.productId, [...(negByProduct.get(w.productId) || []), { name: w.warehouse.name, stock: n(w.stock) }])

  const mapSales = (d: (typeof unpaidOld)[number] & { items?: (typeof sales)[number]['items'] }) => ({
    id: d.id, number: d.number, type: d.type, status: d.status, date: d.date, dueDate: d.dueDate,
    subtotalHT: n(d.subtotalHT), totalFodec: n(d.totalFodec), totalVAT: n(d.totalVAT), timbreFiscal: n(d.timbreFiscal), totalTTC: n(d.totalTTC),
    currency: d.currency || 'TND', clientName: d.client?.name || '—', convertedFromId: d.convertedFromId,
    items: (d.items || []).map(i => ({ productId: i.productId, description: i.description, quantity: n(i.quantity), unitPriceHT: n(i.unitPriceHT), discount: n(i.discount), vatRate: n(i.vatRate) })),
  })

  return {
    now,
    sales: [...unpaidOld.map(mapSales), ...sales.map(mapSales)],
    purchases: purchases.flatMap(p => {
      const type = purchaseDocType(p.type)
      if (!type) return []
      const last = p.receipts.map(r => (r.validatedAt ?? r.date).getTime()).sort((a, b) => b - a)[0]
      return [{
        id: p.id, number: p.number, type, status: p.status, supplierId: p.supplierId, supplierName: p.supplier?.name || '—',
        supplierRef: p.supplierRef, date: p.date, subtotal: n(p.subtotal), taxRate: n(p.taxRate), taxAmount: n(p.taxAmount), total: n(p.total),
        linkedOrderId: p.linkedOrderId, lastReceiptAt: last ? new Date(last) : null,
      }]
    }),
    products: products.map(p => ({
      id: p.id, code: p.code, name: p.name, currentStock: n(p.currentStock), averageCost: n(p.averageCost),
      negativeWarehouses: negByProduct.get(p.id) || [],
    })),
  }
}

/** Applique une détection à la base : création, mise à jour, réouverture, résolution automatique. */
export async function persistAnomalies(tenantId: string, runId: string, detected: DetectedAnomaly[], now: Date) {
  const existing = await prisma.anomaly.findMany({ where: { tenantId }, select: { id: true, fingerprint: true, status: true } })
  const byFp = new Map(existing.map(e => [e.fingerprint, e]))
  const detectedFp = new Set(detected.map(d => d.fingerprint))
  let created = 0

  const toCreate = detected.filter(d => !byFp.has(d.fingerprint))
  if (toCreate.length) {
    const res = await prisma.anomaly.createMany({
      data: toCreate.map(d => ({
        tenantId, type: d.type, severity: d.severity, score: d.score, fingerprint: d.fingerprint,
        documentKind: d.documentKind, documentId: d.documentId, documentRef: d.documentRef,
        amount: d.amount == null ? null : new Prisma.Decimal(d.amount), details: d.params as Prisma.InputJsonValue,
        status: 'OPEN', firstSeenAt: now, lastSeenAt: now, lastRunId: runId,
      })),
      skipDuplicates: true,
    })
    created = res.count
  }

  for (const d of detected) {
    const e = byFp.get(d.fingerprint)
    if (!e) continue
    const status = reconcileStatus(e.status as AnomalyStatus, true)
    await prisma.anomaly.update({
      where: { id: e.id },
      data: {
        severity: d.severity, score: d.score, documentKind: d.documentKind, documentId: d.documentId, documentRef: d.documentRef,
        amount: d.amount == null ? null : new Prisma.Decimal(d.amount), details: d.params as Prisma.InputJsonValue,
        lastSeenAt: now, lastRunId: runId, status,
        ...(status === 'OPEN' && e.status === 'RESOLVED' ? { resolvedAt: null, resolvedById: null } : {}),
      },
    })
  }

  const gone = existing.filter(e => e.status === 'OPEN' && !detectedFp.has(e.fingerprint)).map(e => e.id)
  if (gone.length) {
    await prisma.anomaly.updateMany({ where: { id: { in: gone }, tenantId }, data: { status: 'RESOLVED', resolvedAt: now, resolvedById: null } })
  }
  return { created, autoResolved: gone.length }
}

/** Administrateurs actifs du tenant, hors désinscrits (Tenant.settings.anomalies.emailOptOut = [userId]). */
export function emailOptOut(settings: unknown): string[] {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).anomalies : null
  const list = s && typeof s === 'object' ? (s as Record<string, unknown>).emailOptOut : null
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
}

export async function anomalyRecipients(tenantId: string, settings: unknown, tenantEmail: string | null): Promise<string[]> {
  const optOut = new Set(emailOptOut(settings))
  const admins = await prisma.user.findMany({ where: { tenantId, isActive: true, role: 'ADMIN' }, select: { id: true, email: true } })
  const to = admins.filter(u => !optOut.has(u.id) && u.email && !u.email.endsWith('.local')).map(u => u.email)
  if (!to.length && admins.length === 0 && tenantEmail) return [tenantEmail]
  return to
}

export interface RunResult {
  tenantId: string
  runId: string
  detected: number
  created: number
  autoResolved: number
  open: number
  emailedTo: number
  mailer: string
  errors: string[]
}

/** Analyse complète d'un tenant. `cronDay` = verrou quotidien (1 exécution planifiée / jour / tenant). */
export async function runTenantAnomalies(
  tenantId: string,
  opts: { now?: Date; trigger?: 'CRON' | 'MANUAL'; cronDay?: string | null; sendEmail?: boolean } = {},
): Promise<RunResult | null> {
  const now = opts.now ?? new Date()
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, email: true, settings: true } })
  if (!tenant) return null

  let run
  try {
    run = await prisma.anomalyRun.create({ data: { tenantId, trigger: opts.trigger ?? 'MANUAL', cronDay: opts.cronDay ?? null, status: 'RUNNING', startedAt: now } })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return null // déjà exécuté aujourd'hui
    throw e
  }

  try {
    const cfg = resolveAnomalyConfig(tenant.settings)
    const snapshot = await loadAnomalySnapshot(tenantId, now, cfg)
    const { anomalies, errors } = detectAnomalies(snapshot, cfg)
    const { created, autoResolved } = await persistAnomalies(tenantId, run.id, anomalies, now)

    const open = await prisma.anomaly.findMany({
      where: { tenantId, status: 'OPEN' },
      select: { type: true, severity: true, score: true, amount: true, fingerprint: true, status: true, documentKind: true, documentId: true, details: true },
    })

    let emailedTo = 0
    let mailer: string = selectMailProvider()
    if (opts.sendEmail && open.length > 0) {
      const to = await anomalyRecipients(tenantId, tenant.settings, tenant.email)
      if (to.length && mailer !== 'none') {
        const email = buildAnomalyEmail({
          locale: tenantLocale(tenant.settings),
          tenantName: tenant.name,
          openCount: open.length,
          top: pickTop(open.map(o => ({ ...o, amount: n(o.amount) })), 3),
        })
        const res = await sendMail({ to, ...email })
        mailer = res.provider
        if (res.ok) emailedTo = to.length
        else errors.push(`email: ${res.error}`)
      }
    }

    await prisma.anomalyRun.update({
      where: { id: run.id },
      data: { status: 'DONE', detected: anomalies.length, newCount: created, openCount: open.length, emailedTo, mailer, error: errors.length ? errors.join(' | ').slice(0, 2000) : null, finishedAt: new Date() },
    })
    return { tenantId, runId: run.id, detected: anomalies.length, created, autoResolved, open: open.length, emailedTo, mailer, errors }
  } catch (e) {
    await prisma.anomalyRun.update({
      where: { id: run.id },
      // cronDay libéré : un appel suivant (pg_cron) pourra retenter ce tenant
      data: { status: 'ERROR', cronDay: null, error: (e instanceof Error ? e.message : String(e)).slice(0, 2000), finishedAt: new Date() },
    }).catch(() => undefined)
    throw e
  }
}

/**
 * Lot planifié : traite les tenants actifs pas encore analysés aujourd'hui (heure de Tunis),
 * dans la limite de `budgetMs` (fonctions Vercel limitées en durée). Un nouvel appel reprend la suite.
 */
export async function runAnomalyCronBatch(opts: { now?: Date; budgetMs?: number; tenantId?: string | null; sendEmail?: boolean } = {}) {
  const started = Date.now()
  const now = opts.now ?? new Date()
  const day = tunisDay(now)
  const budget = opts.budgetMs ?? 40_000
  const where: Prisma.TenantWhereInput = { isActive: true, anomalyRuns: { none: { cronDay: day } }, ...(opts.tenantId ? { id: opts.tenantId } : {}) }
  const pending = await prisma.tenant.findMany({ where, select: { id: true }, orderBy: { id: 'asc' }, take: 200 })

  const results: (RunResult | { tenantId: string; error: string })[] = []
  let processed = 0
  for (const t of pending) {
    if (Date.now() - started > budget) break
    try {
      const r = await runTenantAnomalies(t.id, { now, trigger: 'CRON', cronDay: day, sendEmail: opts.sendEmail ?? true })
      if (r) results.push(r)
    } catch (e) {
      results.push({ tenantId: t.id, error: e instanceof Error ? e.message : String(e) })
    }
    processed++
  }
  return { day, processed, remaining: pending.length - processed, done: processed >= pending.length, results }
}

// ─── Interface ─────────────────────────────────────────────────────────────

export async function listAnomalies(tenantId: string, status: AnomalyStatus, limit = 200) {
  const [items, counts, lastRun] = await Promise.all([
    prisma.anomaly.findMany({ where: { tenantId, status }, orderBy: [{ score: 'desc' }, { lastSeenAt: 'desc' }], take: Math.min(500, Math.max(1, limit)) }),
    prisma.anomaly.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
    prisma.anomalyRun.findFirst({ where: { tenantId, status: 'DONE' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true, finishedAt: true, openCount: true, trigger: true } }),
  ])
  const c: Record<string, number> = { OPEN: 0, IGNORED: 0, RESOLVED: 0 }
  for (const g of counts) c[g.status] = g._count._all
  return {
    items: items.map(a => ({ ...a, amount: a.amount == null ? null : n(a.amount) })),
    counts: c,
    lastRun,
  }
}

export async function setAnomalyStatus(tenantId: string, id: string, status: AnomalyStatus, userId: string | null) {
  const found = await prisma.anomaly.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!found) return null
  return prisma.anomaly.update({
    where: { id },
    data: status === 'OPEN' ? { status, resolvedAt: null, resolvedById: null } : { status, resolvedAt: new Date(), resolvedById: userId },
  })
}

export async function getEmailOptOut(tenantId: string, userId: string): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  return emailOptOut(t?.settings).includes(userId)
}

export async function setEmailOptOut(tenantId: string, userId: string, optOut: boolean): Promise<boolean> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  const settings = (t?.settings && typeof t.settings === 'object' ? t.settings : {}) as Record<string, unknown>
  const anomalies = (settings.anomalies && typeof settings.anomalies === 'object' ? settings.anomalies : {}) as Record<string, unknown>
  const list = new Set(emailOptOut(settings))
  if (optOut) list.add(userId)
  else list.delete(userId)
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { settings: { ...settings, anomalies: { ...anomalies, emailOptOut: [...list] } } as Prisma.InputJsonValue },
  })
  return optOut
}
