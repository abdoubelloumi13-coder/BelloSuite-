import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSuperAdminContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { getAllUsers, createUserSchema, SAFE_USER_SELECT } from '@/services/super-admin'
import { logAudit, clientIp } from '@/lib/super-admin-audit'
import { UserRole } from '@prisma/client'

export const runtime = 'nodejs'

// GET /api/super-admin/users?q=&tenantId=  (super admin uniquement, jamais le mot de passe)
export async function GET(req: NextRequest) {
  try {
    const ctx = await getSuperAdminContext(req)
    if (ctx instanceof NextResponse) return ctx
    const sp = req.nextUrl.searchParams
    const users = await getAllUsers(ctx.userRole as UserRole, {
      tenantId: sp.get('tenantId') || null,
      query: (sp.get('q') || '').slice(0, 100) || null,
    })
    return NextResponse.json(users)
  } catch (err) {
    return handleApiError(err, 'GET super-admin users')
  }
}

/**
 * Crée le compte d'authentification Supabase puis l'utilisateur applicatif (rôle + entreprise).
 * Avec SUPABASE_SERVICE_ROLE_KEY (serveur uniquement) : compte confirmé d'office ; sinon signUp classique
 * (l'utilisateur confirme son e-mail selon la configuration Supabase).
 */
async function createAuthAccount(email: string, password: string): Promise<'created' | 'existing'> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || (!serviceKey && !anonKey)) throw new Error('Supabase non configuré')
  if (serviceKey) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (!error) return 'created'
    if (/already|registered|exists/i.test(error.message)) return 'existing'
    throw error
  }
  const client = createClient(url, anonKey!, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signUp({ email, password })
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return 'existing'
    throw error
  }
  // Supabase renvoie un user sans identities quand l'e-mail existe déjà (anti-énumération)
  return data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0 ? 'existing' : 'created'
}

// POST /api/super-admin/users
export async function POST(req: NextRequest) {
  try {
    const ctx = await getSuperAdminContext(req)
    if (ctx instanceof NextResponse) return ctx

    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(createUserSchema, body)
    if (data instanceof NextResponse) return data

    const tenant = await prisma.tenant.findUnique({ where: { id: data.tenantId }, select: { id: true } })
    if (!tenant) return NextResponse.json({ error: 'Entreprise introuvable' }, { status: 404 })

    const existing = await prisma.user.findFirst({ where: { email: { equals: data.email, mode: 'insensitive' } }, select: { id: true } })
    if (existing) return NextResponse.json({ error: 'Un utilisateur avec cet e-mail existe déjà' }, { status: 409 })

    let authAccount: 'created' | 'existing'
    try {
      authAccount = await createAuthAccount(data.email, data.password)
    } catch (e) {
      console.error('[super-admin] création du compte Supabase impossible', e)
      return NextResponse.json({ error: 'Création du compte de connexion impossible' }, { status: 502 })
    }

    const user = await prisma.user.create({
      data: {
        email: data.email,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        password: 'SUPABASE_AUTH', // le mot de passe est géré par Supabase Auth, jamais ici
        role: data.role,
        tenantId: data.tenantId,
        isActive: true,
      },
      select: SAFE_USER_SELECT,
    })

    await logAudit(ctx.user.id, 'USER_CREATE', {
      target: 'user', targetId: user.id, tenantId: data.tenantId,
      details: { email: data.email, role: data.role, authAccount }, ip: clientIp(req),
    })
    return NextResponse.json({ ...user, authAccount }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST super-admin users')
  }
}
