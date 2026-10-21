import { requireSuperAdmin, requireSession } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { signSession, createSessionCookie, SESSION_COOKIE } from '@/lib/session'
import { logAudit, clientIp } from '@/lib/super-admin-audit'

/**
 * Impersonation : le super admin se connecte temporairement en tant qu'user d'un tenant
 * pour reproduire un problème (support). Le cookie de session est remplacé.
 *
 * SÉCURITÉ :
 *  - jeton ET cookie limités à 1 h (avant : jeton signé 7 jours, seul le cookie durait 1 h) ;
 *  - claim `impersonatorId` (id Prisma du super admin) : tracé dans l'audit et utilisé pour restaurer sa session ;
 *  - la session reste revalidée en base à chaque requête (compte cible actif, entreprise non suspendue).
 *
 * POST   /api/super-admin/impersonate { userId }
 * DELETE /api/super-admin/impersonate → fin d'impersonation : restaure la session du super admin.
 */
const IMPERSONATION_SECONDS = 60 * 60

const schema = z.object({ userId: z.string().min(1).max(64) })

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'userId requis' }, { status: 400 })
    const { userId } = parsed.data

    const admin = await prisma.user.findFirst({
      where: { email: { equals: auth.email, mode: 'insensitive' }, role: 'SUPER_ADMIN', isActive: true },
      select: { id: true },
    })
    if (!admin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

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

    const token = await signSession({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      firstName: user.firstName || '',
      impersonatorId: admin.id,
    }, { expiresInSeconds: IMPERSONATION_SECONDS })

    await logAudit(auth.id, 'IMPERSONATE_START', {
      target: 'user', targetId: user.id, tenantId: user.tenantId,
      details: { email: user.email, impersonatorId: admin.id, expiresInSeconds: IMPERSONATION_SECONDS }, ip: clientIp(req),
    })

    const res = NextResponse.json({ ok: true, user: { id: user.id, email: user.email, tenantId: user.tenantId } })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: IMPERSONATION_SECONDS,
      path: '/',
    })
    return res
  } catch (e) {
    console.error('[super-admin] impersonate', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

/** Fin d'impersonation : la session courante est celle de l'utilisateur cible ; on restaure le super admin. */
export async function DELETE(req: Request) {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session
  try {
    if (!session.impersonatorId) {
      // Pas d'impersonation en cours : un super admin qui appelle DELETE ne change rien.
      if (session.role === 'SUPER_ADMIN') return NextResponse.json({ ok: true })
      return NextResponse.json({ error: 'Aucune impersonation en cours' }, { status: 400 })
    }
    const admin = await prisma.user.findUnique({
      where: { id: session.impersonatorId },
      select: { id: true, email: true, role: true, tenantId: true, firstName: true, isActive: true },
    })
    await logAudit(session.impersonatorId, 'IMPERSONATE_END', {
      target: 'user', targetId: session.id, tenantId: session.tenantId, ip: clientIp(req),
    })
    if (!admin || !admin.isActive || admin.role !== 'SUPER_ADMIN') {
      const res = NextResponse.json({ ok: true, restored: false })
      res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
      return res
    }
    await createSessionCookie({
      id: admin.id, email: admin.email, role: admin.role, tenantId: admin.tenantId, firstName: admin.firstName || '',
    })
    return NextResponse.json({ ok: true, restored: true })
  } catch (e) {
    console.error('[super-admin] impersonate DELETE', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
