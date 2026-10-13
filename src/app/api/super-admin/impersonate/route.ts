import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { signSession, SESSION_COOKIE } from '@/lib/session'
import { logAudit, clientIp } from '@/lib/super-admin-audit'

/**
 * Impersonation : le super admin se connecte temporairement en tant qu'user d'un tenant
 * pour reproduire un problème (support). Le cookie de session est remplacé —
 * une page de notification "mode impersonation" s'affiche (voir middleware/layout).
 * L'action est journalisée dans l'audit log.
 *
 * POST /api/super-admin/impersonate { userId }
 */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { userId } = await req.json()
    if (!userId) return NextResponse.json({ error: 'userId requis' }, { status: 400 })

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, tenantId: true, firstName: true, isActive: true },
    })
    if (!user) return NextResponse.json({ error: 'User introuvable' }, { status: 404 })
    if (user.role === 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Impersonation d\'un super admin impossible' }, { status: 400 })
    }
    if (!user.isActive) {
      return NextResponse.json({ error: 'Ce compte est désactivé' }, { status: 400 })
    }

    // Session signée pour l'user cible (valide 1h max via duration standard)
    const token = await signSession({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      firstName: user.firstName || '',
    })

    await logAudit(auth.id, 'IMPERSONATE_START', {
      target: 'user', targetId: user.id, tenantId: user.tenantId,
      details: { email: user.email }, ip: clientIp(req),
    })

    const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, tenantId: user.tenantId } })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60, // 1h max pour l'impersonation
      path: '/',
    })
    return res
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/** Stop l'impersonation : repasse en session super admin. */
export async function DELETE(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    await logAudit(auth.id, 'IMPERSONATE_END', { ip: clientIp(req) })
    const res = NextResponse.json({ ok: true })
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
    return res
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
