import { getUserAdminContext, actorPrismaId } from '@/lib/tenant-user-admin'
import { NextRequest, NextResponse } from 'next/server'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { sendPasswordResetEmail, appOrigin } from '@/lib/auth-accounts'
import { logAudit, clientIp } from '@/lib/super-admin-audit'
import { enforceRateLimits } from '@/lib/rate-limit-persistent'

export const runtime = 'nodejs'
const LOCALES = ['fr', 'ar', 'en']

// POST /api/tenant/users/:id/reset-password — envoie à l'utilisateur le lien Supabase de réinitialisation
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getUserAdminContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true, isActive: true, tenantId: true } })
    if (!target || target.tenantId !== ctx.tenantId || target.role === 'SUPER_ADMIN') return NextResponse.json({ error: 'Utilisateur introuvable' }, { status: 404 })
    if (!target.isActive) return NextResponse.json({ error: 'Compte désactivé : réactivez-le d\'abord' }, { status: 400 })
    const limited = await enforceRateLimits([{ key: `forgot:email:${target.email.toLowerCase()}`, max: 3, windowSeconds: 60 * 60 }])
    if (limited) return limited

    const body = await req.json().catch(() => ({})) as { locale?: unknown }
    const locale = typeof body?.locale === 'string' && LOCALES.includes(body.locale) ? body.locale : 'fr'
    try {
      await sendPasswordResetEmail(target.email, appOrigin(req), locale)
    } catch (e) {
      console.error('[tenant-users] envoi du lien de réinitialisation impossible', e)
      return NextResponse.json({ error: 'Envoi de l\'e-mail impossible' }, { status: 502 })
    }
    const actorId = await actorPrismaId(ctx.user.email)
    if (actorId) await logAudit(actorId, 'TENANT_USER_PASSWORD_RESET', { target: 'user', targetId: id, tenantId: ctx.tenantId, ip: clientIp(req) })
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleApiError(err, 'POST tenant user reset-password')
  }
}
