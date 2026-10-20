/**
 * Côté entreprise : donner ou retirer l'accès à son cabinet comptable.
 *  GET    /api/tenant/firm-access           → cabinets ayant (eu) accès
 *  POST   /api/tenant/firm-access           → nouveau code d'invitation (affiché UNE fois, 7 jours, usage unique)
 *  DELETE /api/tenant/firm-access?firmId=…  → révoque l'accès (effet immédiat)
 * Réservé à l'ADMIN de l'entreprise, jamais depuis une session cabinet.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireTenant } from '@/lib/api-auth'
import { handleApiError } from '@/lib/errors'
import { generateInviteCode, hashInviteCode, inviteExpiry } from '@/lib/firm-logic'
import { enforceRateLimits } from '@/lib/rate-limit-persistent'

export const runtime = 'nodejs'

async function ownerContext(req: Request) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  if (ctx.user.firmId) return NextResponse.json({ error: 'Réservé à l’entreprise' }, { status: 403 })
  if (ctx.userRole !== 'ADMIN' && ctx.userRole !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Réservé à l’administrateur' }, { status: 403 })
  return ctx
}

export async function GET(req: Request) {
  try {
    const ctx = await ownerContext(req)
    if (ctx instanceof NextResponse) return ctx
    const accesses = await prisma.firmClientAccess.findMany({
      where: { tenantId: ctx.tenantId },
      select: { firmId: true, status: true, origin: true, createdAt: true, revokedAt: true, firm: { select: { name: true, matriculeFiscal: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ accesses })
  } catch (err) {
    return handleApiError(err, 'GET tenant/firm-access')
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await ownerContext(req)
    if (ctx instanceof NextResponse) return ctx
    const limited = await enforceRateLimits([{ key: `firm-invite:tenant:${ctx.tenantId}`, max: 10, windowSeconds: 3600 }])
    if (limited) return limited
    const code = generateInviteCode()
    const expiresAt = inviteExpiry()
    await prisma.firmInvite.create({ data: { tenantId: ctx.tenantId, codeHash: hashInviteCode(code), createdById: ctx.user.id, expiresAt } })
    return NextResponse.json({ code, expiresAt: expiresAt.toISOString() }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST tenant/firm-access')
  }
}

export async function DELETE(req: Request) {
  try {
    const ctx = await ownerContext(req)
    if (ctx instanceof NextResponse) return ctx
    const firmId = new URL(req.url).searchParams.get('firmId')
    if (!firmId) return NextResponse.json({ error: 'firmId requis' }, { status: 400 })
    const res = await prisma.firmClientAccess.updateMany({ where: { tenantId: ctx.tenantId, firmId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: new Date() } })
    if (res.count === 0) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    return NextResponse.json({ revoked: true })
  } catch (err) {
    return handleApiError(err, 'DELETE tenant/firm-access')
  }
}
