/**
 * GET /api/super-admin/billing — vue détaillée par entreprise : utilisateurs, modules facturés,
 * facture mensuelle HT/TTC, activité 30 jours (factures, tickets POS, écritures, bulletins) et dernière activité.
 */
import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/api-auth'
import { prisma } from '@/lib/db'
import { tenantInvoice, activityScore, withUserPricing, billingSettings } from '@/lib/super-admin/billing'

type Group = { tenantId: string; _count: { _all: number }; _max: { createdAt: Date | null } }

async function grouped(fn: () => Promise<unknown>): Promise<Map<string, Group>> {
  try {
    const rows = (await fn()) as Group[]
    return new Map(rows.map(r => [r.tenantId, r]))
  } catch (e) {
    console.warn('[super-admin billing] agrégat ignoré', e)
    return new Map()
  }
}

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const since = new Date(Date.now() - 30 * 86_400_000)
    const agg = { by: ['tenantId'] as const, where: { createdAt: { gte: since } }, _count: { _all: true }, _max: { createdAt: true } }
    const [tenants, modules, users, invoices, pos, entries, payslips] = await Promise.all([
      prisma.tenant.findMany({ select: { id: true, name: true, subdomain: true, isActive: true, createdAt: true, email: true, phone: true, city: true, modules: true }, orderBy: { createdAt: 'desc' } }),
      prisma.module.findMany({ orderBy: { name: 'asc' } }).then(ms => ms.map(withUserPricing)),
      prisma.user.groupBy({ by: ['tenantId'], where: { isActive: true, tenantId: { not: null } }, _count: { _all: true } }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      grouped(() => (prisma.invoice.groupBy as any)(agg)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      grouped(() => (prisma.pOSOrder.groupBy as any)(agg)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      grouped(() => (prisma.journalEntry.groupBy as any)(agg)),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      grouped(() => (prisma.paySlip.groupBy as any)(agg)),
    ])
    const usersBy = new Map(users.map(u => [u.tenantId as string, u._count._all]))
    const now = new Date()

    const rows = tenants.map(t => {
      const activeUsers = usersBy.get(t.id) ?? 0
      const tms = t.modules.map(m => ({ moduleId: m.moduleId, isEnabled: m.isEnabled, ...billingSettings(m.settings) }))
      const invoice = tenantInvoice(modules, tms, activeUsers)
      const counts = {
        invoices: invoices.get(t.id)?._count._all ?? 0,
        posOrders: pos.get(t.id)?._count._all ?? 0,
        entries: entries.get(t.id)?._count._all ?? 0,
        payslips: payslips.get(t.id)?._count._all ?? 0,
      }
      const dates = [invoices, pos, entries, payslips].map(m => m.get(t.id)?._max.createdAt).filter(Boolean) as Date[]
      const lastActivity = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null
      const docs30d = counts.invoices + counts.posOrders + counts.entries + counts.payslips
      return {
        id: t.id, name: t.name, subdomain: t.subdomain, isActive: t.isActive, createdAt: t.createdAt,
        email: t.email, phone: t.phone, city: t.city, activeUsers,
        modules: tms,
        invoice, activity: { ...counts, docs30d, lastActivity, ...activityScore(docs30d, lastActivity, now) },
      }
    })
    const active = rows.filter(r => r.isActive)
    const summary = {
      tenants: rows.length,
      activeTenants: active.length,
      mrrHT: Math.round(active.reduce((s, r) => s + r.invoice.totalHT, 0) * 1000) / 1000,
      dormant: active.filter(r => r.activity.status === 'dormant' || r.activity.status === 'never').length,
      users: active.reduce((s, r) => s + r.activeUsers, 0),
      byModule: modules.map(m => {
        const lines = active.flatMap(r => r.invoice.lines.filter(l => l.moduleId === m.id))
        return { moduleId: m.id, name: m.displayName, tenants: lines.length, users: lines.reduce((s, l) => s + l.users, 0), revenueHT: Math.round(lines.reduce((s, l) => s + l.total, 0) * 1000) / 1000 }
      }),
    }
    const catalog = modules.map(m => ({ id: m.id, name: m.name, displayName: m.displayName, icon: m.icon, isActive: m.isActive, monthlyPrice: Number(m.monthlyPrice), pricePerUser: Number(m.pricePerUser), includedUsers: m.includedUsers }))
    return NextResponse.json({ summary, tenants: rows, modules: catalog })
  } catch (err) {
    console.error('[super-admin] GET billing', err)
    return NextResponse.json({ error: 'Chargement de la facturation impossible ' }, { status: 500 })
  }
}
