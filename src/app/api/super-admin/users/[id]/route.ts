import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logAudit, clientIp } from '@/lib/super-admin-audit'
import { invalidateIdentityCache } from '@/lib/session-guard'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { isActive, role } = (body && typeof body === 'object' ? body : {}) as { isActive?: unknown; role?: unknown }
    if (role !== undefined && !['SUPER_ADMIN', 'ADMIN', 'USER'].includes(role as string)) {
      return NextResponse.json({ error: 'Rôle invalide' }, { status: 400 })
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive invalide' }, { status: 400 })
    }
    const user = await prisma.user.update({
      where: { id },
      data: { ...(isActive !== undefined ? { isActive: isActive as boolean } : {}), ...(role ? { role: role as 'SUPER_ADMIN' | 'ADMIN' | 'USER' } : {}) }
    })
    invalidateIdentityCache({ email: user.email })
    if (isActive !== undefined) {
      await logAudit(auth.id, isActive ? 'USER_ACTIVATE' : 'USER_DEACTIVATE', {
        target: 'user', targetId: id, tenantId: user.tenantId, ip: clientIp(req),
      })
    }
    if (role !== undefined) {
      await logAudit(auth.id, 'USER_ROLE_CHANGE', {
        target: 'user', targetId: id, tenantId: user.tenantId,
        details: { role: role as string }, ip: clientIp(req),
      })
    }
    const { password: _, ...safe } = user
    return NextResponse.json(safe)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  }
}

/**
 * Suppression d'un user. Deux modes :
 *  - { mode: 'soft' } (défaut) : désactive le compte (récupérable)
 *  - { mode: 'hard' } : suppression physique du compte (IRREVERSIBLE)
 * Sécurité : impossible de supprimer un SUPER_ADMIN, ni de désactiver
 * le dernier ADMIN actif d'un tenant.
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    const { mode = 'soft' } = await req.json().catch(() => ({}))

    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })
    if (user.role === 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Impossible de supprimer un super admin' }, { status: 400 })
    }

    if (mode === 'hard') {
      await prisma.user.delete({ where: { id } })
      invalidateIdentityCache({ email: user.email })
      await logAudit(auth.id, 'USER_DELETE_HARD', {
        target: 'user', targetId: id, tenantId: user.tenantId,
        details: { email: user.email }, ip: clientIp(req),
      })
      return NextResponse.json({ success: true, mode: 'hard' })
    }

    // Soft : si c'est l'ADMIN du tenant, vérifier qu'un autre admin actif existe
    const activeAdmins = await prisma.user.count({
      where: { tenantId: user.tenantId, role: 'ADMIN', isActive: true },
    })
    if (user.role === 'ADMIN' && activeAdmins <= 1) {
      return NextResponse.json(
        { error: 'Dernier admin du tenant : impossible de désactiver (supprimez le tenant ou promouvez un autre user)' },
        { status: 400 }
      )
    }
    await prisma.user.update({ where: { id }, data: { isActive: false } })
    invalidateIdentityCache({ email: user.email })
    await logAudit(auth.id, 'USER_DEACTIVATE', {
      target: 'user', targetId: id, tenantId: user.tenantId,
      details: { email: user.email, soft: true }, ip: clientIp(req),
    })
    return NextResponse.json({ success: true, mode: 'soft' })
  } catch (error) {
    console.error('[super-admin] DELETE user error', error)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
