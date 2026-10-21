import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSessionCookie } from '@/lib/session'
import { enforceRateLimits, clientIp } from '@/lib/rate-limit-persistent'
import { resolveIdentityFromDb } from '@/lib/user-identity'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req)
    const ipLimited = await enforceRateLimits([{ key: `login:ip:${ip}`, max: 5, windowSeconds: 60 }])
    if (ipLimited) return ipLimited

    let email: string, password: string
    try {
      const body = await req.json()
      email = body.email
      password = body.password
    } catch {
      return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 })
    }

    if (!email || !password) {
      return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 })
    }

    // Anti force brute sur un compte précis, même depuis plusieurs IP
    const emailLimited = await enforceRateLimits([
      { key: `login:email:${String(email).trim().toLowerCase()}`, max: 10, windowSeconds: 15 * 60 },
    ])
    if (emailLimited) return emailLimited

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.user) {
      return NextResponse.json({ error: 'Identifiants incorrects' }, { status: 401 })
    }

    // Rôle et tenant : uniquement depuis la table User (Prisma), jamais depuis user_metadata.
    const identity = await resolveIdentityFromDb(data.user.email!)
    if (!identity.isActive) {
      return NextResponse.json({ error: 'Compte désactivé' }, { status: 403 })
    }
    if (identity.tenantActive === false && identity.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Entreprise suspendue : contactez le support BelloSuite' }, { status: 403 })
    }
    const { role, tenantId, firstName } = identity

    const session = {
      id: data.user.id,
      email: data.user.email!,
      role,
      tenantId,
      firstName: firstName || data.user.email?.split('@')[0] || '',
    }

    await createSessionCookie(session)

    return NextResponse.json({ success: true, role })
  } catch (err) {
    console.error('Login error:', err)
    return NextResponse.json({ error: 'Erreur interne du serveur' }, { status: 500 })
  }
}
