/**
 * POST /api/firm/join { code } — le cabinet saisit le code d'invitation donné par l'entreprise cliente.
 * Code haché, usage unique, 7 jours ; consommation atomique (updateMany sur usedAt null).
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/api-auth'
import { parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getFirmMembership } from '@/lib/firm-access'
import { hashInviteCode, inviteState, normalizeInviteCode } from '@/lib/firm-logic'
import { enforceRateLimits } from '@/lib/rate-limit-persistent'

export const runtime = 'nodejs'

const schema = z.object({ code: z.string().trim().min(8).max(20) })
const INVALID = () => NextResponse.json({ error: 'Code invalide ou expiré' }, { status: 400 })

export async function POST(req: Request) {
  try {
    const session = await requireSession(req)
    if (session instanceof NextResponse) return session
    const m = await getFirmMembership(session.id)
    if (!m) return NextResponse.json({ error: 'Aucun cabinet' }, { status: 403 })
    // Anti force brute : 10 essais / heure / cabinet
    const limited = await enforceRateLimits([{ key: `firm-join:firm:${m.firmId}`, max: 10, windowSeconds: 3600 }])
    if (limited) return limited
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(schema, body)
    if (data instanceof NextResponse) return data
    if (!normalizeInviteCode(data.code)) return INVALID()

    const invite = await prisma.firmInvite.findUnique({ where: { codeHash: hashInviteCode(data.code) } })
    if (!invite || inviteState(invite) !== 'OK') return INVALID()

    const result = await prisma.$transaction(async (tx) => {
      const used = await tx.firmInvite.updateMany({ where: { id: invite.id, usedAt: null }, data: { usedAt: new Date(), usedByFirm: m.firmId } })
      if (used.count !== 1) return null
      return tx.firmClientAccess.upsert({
        where: { firmId_tenantId: { firmId: m.firmId, tenantId: invite.tenantId } },
        create: { firmId: m.firmId, tenantId: invite.tenantId, status: 'ACTIVE', origin: 'INVITE', grantedById: invite.createdById },
        update: { status: 'ACTIVE', revokedAt: null, origin: 'INVITE', grantedById: invite.createdById },
        select: { tenant: { select: { id: true, name: true } } },
      })
    })
    if (!result) return INVALID()
    return NextResponse.json({ client: result.tenant }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST firm/join')
  }
}
