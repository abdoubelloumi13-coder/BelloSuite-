import { getUserAdminContext, actorPrismaId } from '@/lib/tenant-user-admin'
import { NextRequest, NextResponse } from 'next/server'
import { parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { tenantUpdateUserSchema, checkTenantUserChange } from '@/services/tenant-users'
import { logAudit, clientIp } from '@/lib/super-admin-audit'
import { invalidateIdentityCache } from '@/lib/session-guard'

export const runtime = 'nodejs'

// PATCH /api/tenant/users/:id — nom, rôle (ADMIN/USER), activation
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getUserAdminContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params

    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const change = parseBody(tenantUpdateUserSchema, body)
    if (change instanceof NextResponse) return change

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, isActive: true, tenantId: true } })
    if (!target || target.tenantId !== ctx.tenantId) return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    const activeAdmins = await prisma.user.count({ where: { tenantId: ctx.tenantId, role: 'ADMIN', isActive: true } })
    const refused = checkTenantUserChange({ actorEmail: ctx.user.email, tenantId: ctx.tenantId, target, change, activeAdmins })
    if (refused) return NextResponse.json({ error: refused }, { status: 400 })

    const user = await prisma.user.update({
      where: { id },
      data: change,
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true, updatedAt: true },
    })
    invalidateIdentityCache({ email: user.email })
    const actorId = await actorPrismaId(ctx.user.email)
    if (actorId) {
      const ip = clientIp(req)
      if (change.isActive !== undefined && change.isActive !== target.isActive)
        await logAudit(actorId, change.isActive ? 'TENANT_USER_ACTIVATE' : 'TENANT_USER_DEACTIVATE', { target: 'user', targetId: id, tenantId: ctx.tenantId, ip })
      if (change.role !== undefined && change.role !== target.role)
        await logAudit(actorId, 'TENANT_USER_ROLE_CHANGE', { target: 'user', targetId: id, tenantId: ctx.tenantId, details: { from: target.role, to: change.role }, ip })
    }
    return NextResponse.json(user)
  } catch (err) {
    return handleApiError(err, 'PATCH tenant user')
  }
}
