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
import { logAudit, clientIp } from '@/lib/super-admin-audit'

const schema = z.object({
  modules: z.array(z.object({ moduleId: z.string().min(1).max(64), isEnabled: z.boolean() }).strict()).max(100),
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

    await prisma.$transaction(data.modules.map(m => prisma.tenantModule.upsert({
      where: { tenantId_moduleId: { tenantId: id, moduleId: m.moduleId } },
      update: { isEnabled: m.isEnabled },
      create: { tenantId: id, moduleId: m.moduleId, isEnabled: m.isEnabled },
    })))
    await logAudit(auth.id, 'TENANT_MODULES_UPDATE', {
      target: 'tenant', targetId: id, tenantId: id,
      details: { enabled: data.modules.filter(m => m.isEnabled).map(m => m.moduleId) }, ip: clientIp(req),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[super-admin] PUT tenant modules', err)
    return NextResponse.json({ error: 'Mise à jour des modules impossible' }, { status: 500 })
  }
}
