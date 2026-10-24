import { getUserAdminContext, actorPrismaId } from '@/lib/tenant-user-admin'
import { NextRequest, NextResponse } from 'next/server'
import { parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { createAuthAccount, lastSignIns } from '@/lib/auth-accounts'
import { tenantCreateUserSchema, userStats } from '@/services/tenant-users'
import { logAudit, clientIp } from '@/lib/super-admin-audit'
import { enforceRateLimits } from '@/lib/rate-limit-persistent'
import { invalidateIdentityCache } from '@/lib/session-guard'

export const runtime = 'nodejs'

const SELECT = { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true, updatedAt: true } as const

// GET /api/tenant/users — tableau de bord des utilisateurs de l'entreprise (jamais le mot de passe)
export async function GET(req: NextRequest) {
  try {
    const ctx = await getUserAdminContext(req)
    if (ctx instanceof NextResponse) return ctx
    const users = await prisma.user.findMany({
      where: { tenantId: ctx.tenantId, role: { not: 'SUPER_ADMIN' } },
      select: SELECT,
      orderBy: [{ isActive: 'desc' }, { email: 'asc' }],
    })
    const signIns = await lastSignIns(users.map(u => u.email))
    const me = (ctx.user.email || '').toLowerCase()
    return NextResponse.json({
      users: users.map(u => ({ ...u, lastSignInAt: signIns[u.email.toLowerCase()] ?? null, isSelf: u.email.toLowerCase() === me })),
      stats: userStats(users),
    })
  } catch (err) {
    return handleApiError(err, 'GET tenant users')
  }
}

// POST /api/tenant/users — l'admin de l'entreprise ajoute un utilisateur (ADMIN ou USER)
export async function POST(req: NextRequest) {
  try {
    const ctx = await getUserAdminContext(req)
    if (ctx instanceof NextResponse) return ctx
    const limited = await enforceRateLimits([{ key: `tenant-users:create:${ctx.tenantId}`, max: 20, windowSeconds: 60 * 60 }])
    if (limited) return limited

    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(tenantCreateUserSchema, body)
    if (data instanceof NextResponse) return data

    const existing = await prisma.user.findFirst({ where: { email: { equals: data.email, mode: 'insensitive' } }, select: { id: true } })
    if (existing) return NextResponse.json({ error: 'Un utilisateur avec cet e-mail existe déjà' }, { status: 409 })

    let authAccount: 'created' | 'existing'
    try {
      authAccount = await createAuthAccount(data.email, data.password)
    } catch (e) {
      console.error('[tenant-users] création du compte Supabase impossible', e)
      return NextResponse.json({ error: 'Création du compte de connexion impossible' }, { status: 502 })
    }

    const user = await prisma.user.create({
      data: {
        email: data.email, firstName: data.firstName || '', lastName: data.lastName || '',
        password: 'SUPABASE_AUTH', role: data.role, tenantId: ctx.tenantId, isActive: true,
      },
      select: SELECT,
    })
    invalidateIdentityCache({ email: user.email })
    const actorId = await actorPrismaId(ctx.user.email)
    if (actorId) await logAudit(actorId, 'TENANT_USER_CREATE', {
      target: 'user', targetId: user.id, tenantId: ctx.tenantId,
      details: { email: data.email, role: data.role, authAccount, by: 'tenant-admin' }, ip: clientIp(req),
    })
    return NextResponse.json({ ...user, authAccount }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST tenant users')
  }
}
