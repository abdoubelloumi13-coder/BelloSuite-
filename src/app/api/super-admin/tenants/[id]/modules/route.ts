/**
 * PUT /api/super-admin/tenants/[id]/modules { modules: [{ moduleId, isEnabled }] }
 * Active / désactive les modules d'une entreprise (super admin uniquement, journalisé).
 * Remplace l'ancienne Server Action `toggleTenantModule`, appelable sans authentification.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/api-auth'
import { parseBody } from '@/lib/api'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { logAudit, clientIp } from '@/lib/super-admin-audit'

const schema = z.object({
  modules: z.array(z.object({
    moduleId: z.string().min(1).max(64),
    isEnabled: z.boolean(),
    seats: z.number().int().min(0).max(10000).optional(),
    priceOverride: z.number().min(0).max(1_000_000).nullable().optional(),
    discountPercent: z.number().min(0).max(100).optional(),
  }).strict()).max(100),
}).strict()

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(schema, body)
    if (data instanceof NextResponse) return data

    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } })
    if (!tenant) return NextResponse.json({ error: 'Entreprise introuvable' }, { status: 404 })
    const ids = data.modules.map(m => m.moduleId)
    const known = await prisma.module.count({ where: { id: { in: ids } } })
    if (known !== new Set(ids).size) return NextResponse.json({ error: 'Module inconnu' }, { status: 400 })

    const existing = await prisma.tenantModule.findMany({ where: { tenantId: id, moduleId: { in: ids } }, select: { moduleId: true, settings: true } })
    const settingsOf = new Map(existing.map(e => [e.moduleId, (e.settings && typeof e.settings === 'object' ? e.settings : {}) as Record<string, unknown>]))
    // Sièges, prix négocié et remise : TenantModule.settings.billing (aucune migration nécessaire)
    const nextSettings = (m: (typeof data.modules)[number]) => {
      const cur = settingsOf.get(m.moduleId) ?? {}
      const billing = { ...((cur.billing as Record<string, unknown>) ?? {}) }
      if (m.seats !== undefined) billing.seats = m.seats
      if (m.priceOverride !== undefined) billing.priceOverride = m.priceOverride
      if (m.discountPercent !== undefined) billing.discountPercent = m.discountPercent
      return { ...cur, billing } as Prisma.InputJsonValue
    }
    await prisma.$transaction(data.modules.map(m => prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: id, moduleId: m.moduleId } },
      update: { isEnabled: m.isEnabled, settings: nextSettings(m) },
      create: { tenantId: id, moduleId: m.moduleId, isEnabled: m.isEnabled, settings: nextSettings(m) },
    })))
    await logAudit(auth.id, 'TENANT_MODULES_UPDATE', {
      target: 'tenant', targetId: id, tenantId: id,
      details: { enabled: data.modules.filter(m => m.isEnabled).map(m => m.moduleId), changes: data.modules }, ip: clientIp(req),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[super-admin] PUT tenant modules', err)
    return NextResponse.json({ error: 'Mise à jour des modules impossible' }, { status: 500 })
  }
}
