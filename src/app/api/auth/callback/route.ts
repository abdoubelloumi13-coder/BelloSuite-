import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase/server'
import { resolveIdentityFromDb } from '@/lib/user-identity'
import { createSessionCookie } from '@/lib/session'
import { postLoginPath } from '@/lib/onboarding'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  const rawLocale = searchParams.get('locale') ?? 'fr'
  const locale = ['fr', 'ar', 'en'].includes(rawLocale) ? rawLocale : 'fr'

  if (code) {
    const supabase = await supabaseServer()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('Supabase exchangeCodeForSession error:', error)
      return NextResponse.redirect(`${origin}/${locale}/login?error=exchange_failed`) // détail technique seulement dans les logs
    }

    if (!error && data.user) {
      // Rôle et tenant : uniquement depuis la table User (Prisma). user_metadata ne sert qu'au prénom/nom
      // d'un compte nouvellement créé (rôle USER, sans tenant), jamais à l'autorisation.
      let identity
      try {
        identity = await resolveIdentityFromDb(data.user.email!, {
          firstName: data.user.user_metadata?.full_name?.split(' ')[0] || data.user.user_metadata?.given_name || '',
          lastName: data.user.user_metadata?.family_name || '',
        })
      } catch (e) {
        console.error('OAuth callback: lecture User impossible', e)
        return NextResponse.redirect(`${origin}/${locale}/login?error=auth_failed`)
      }
      if (!identity.isActive) {
        return NextResponse.redirect(`${origin}/${locale}/login?error=account_disabled`)
      }
      if (identity.tenantActive === false && identity.role !== 'SUPER_ADMIN') {
        return NextResponse.redirect(`${origin}/${locale}/login?error=tenant_suspended`)
      }
      const { role, tenantId, firstName } = identity

      const session = { id: data.user.id, email: data.user.email!, role, tenantId, firstName }
      await createSessionCookie(session)

      // Chemin absolu avec préfixe de langue (sinon le proxy redirige vers /fr/...).
      // SUPER_ADMIN → /super-admin (jamais l'onboarding) ; sans tenant → /onboarding ; sinon `next`.
      const target = postLoginPath(locale, role, tenantId, next)
      return NextResponse.redirect(`${origin}${target}`)
    }
  }

  const errorParam = searchParams.get('error')
  const errorDesc = searchParams.get('error_description')
  if (errorParam) {
    return NextResponse.redirect(`${origin}/${locale}/login?error=${errorParam}&details=${encodeURIComponent(errorDesc || '')}`)
  }
  return NextResponse.redirect(`${origin}/${locale}/login?error=auth_failed_no_code`)
}