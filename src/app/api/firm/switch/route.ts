/**
 * POST /api/firm/switch { tenantId } — ouvre le dossier d'un client : la session est ré-émise avec le tenant du
 * client, firmId et homeTenantId. { tenantId: null } revient au compte propre de l'utilisateur.
 * Dans le dossier, le rôle dépend du rôle dans le cabinet : OWNER → ADMIN ; STAFF → USER limité (paie/RH et
 * comptabilité autorisées, jamais les paramètres TTN/e-facture ni les utilisateurs — voir lib/rbac.ts).
 * L'accès et le rôle sont revérifiés en base à chaque requête ; la gestion des accès cabinet reste interdite
 * depuis une session cabinet.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/api-auth'
import { parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { createSessionCookie } from '@/lib/session'
import { firmHasActiveAccess, getFirmMembership } from '@/lib/firm-access'
import { firmEffectiveRole } from '@/lib/session-guard'

export const runtime = 'nodejs'

const schema = z.object({ tenantId: z.string().uuid().nullable() })

export async function POST(req: Request) {
  try {
    const session = await requireSession(req)
    if (session instanceof NextResponse) return session
    if (session.role === 'SUPER_ADMIN') return NextResponse.json({ error: 'Non disponible pour le Super Admin' }, { status: 403 })
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(schema, body)
    if (data instanceof NextResponse) return data

    const dbUser = await prisma.user.findUnique({ where: { id: session.id }, select: { id: true, email: true, role: true, tenantId: true, firstName: true, isActive: true } })
    if (!dbUser || !dbUser.isActive) return NextResponse.json({ error: 'Compte introuvable ou désactivé' }, { status: 403 })
    const home = { id: dbUser.id, email: dbUser.email, role: dbUser.role, tenantId: dbUser.tenantId, firstName: dbUser.firstName || session.firstName || '' }

    if (data.tenantId === null || data.tenantId === dbUser.tenantId) {
      await createSessionCookie(home)
      return NextResponse.json({ tenantId: dbUser.tenantId, firm: false })
    }

    const m = await getFirmMembership(session.id)
    if (!m || !(await firmHasActiveAccess(m.firmId, data.tenantId))) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    await createSessionCookie({ ...home, role: firmEffectiveRole(m.role), firmRole: m.role, tenantId: data.tenantId, firmId: m.firmId, homeTenantId: dbUser.tenantId })
    return NextResponse.json({ tenantId: data.tenantId, firm: true })
  } catch (err) {
    return handleApiError(err, 'POST firm/switch')
  }
}
