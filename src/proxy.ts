import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { jwtVerify } from 'jose'
import { routing } from '@/i18n/routing'
import { rateLimit } from './lib/rate-limit'
import { getSessionSecretKey, MissingSessionSecretError } from './lib/session-secret'
import { stripIdentityHeaders } from './lib/identity-headers'

function stripLocale(pathname: string): string {
  const locale = routing.locales.find(
    l => pathname.startsWith(`/${l}/`) || pathname === `/${l}`
  )
  return locale ? pathname.replace(`/${locale}`, '') || '/' : pathname
}

// /terms et /privacy : pages légales publiques (liens depuis l'inscription)
const PUBLIC_AUTH = ['/login', '/register', '/forgot-password', '/reset-password', '/onboarding', '/demo', '/terms', '/privacy']
const PUBLIC_API_PATTERNS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/callback',
  '/api/auth/session',
  '/api/auth/demo',
  '/api/health',
  // /api/cron/* n'a pas de cookie : protégé dans la route par CRON_SECRET (checkCronSecret)
  '/api/cron/',
]
const STRICT_RATE_LIMIT_ROUTES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/forgot-password',
  '/api/auth/demo',
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const cleanPath = stripLocale(pathname)

  const locale = routing.locales.find(
    l => pathname.startsWith(`/${l}/`) || pathname === `/${l}`
  ) || 'fr'

  // Pages sans préfixe de langue (/super-admin, /dashboard, /onboarding…) : rediriger vers /fr/...
  // Sinon Next interprète le 1er segment comme [locale] et les redirections serveur bouclent.
  const hasLocale = routing.locales.some(l => pathname === `/${l}` || pathname.startsWith(`/${l}/`))
  if (!hasLocale && !pathname.startsWith('/api/') && !pathname.startsWith('/auth/') && pathname !== '/' && pathname !== '/login' && !/\.[a-z0-9]+$/i.test(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = `/${routing.defaultLocale}${pathname}`
    return NextResponse.redirect(url)
  }

  if (cleanPath.startsWith('/api/')) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      'unknown'
    const isStrict = STRICT_RATE_LIMIT_ROUTES.some(r => cleanPath.startsWith(r))
    const maxRequests = isStrict ? 10 : 100
    const result = rateLimit(`${ip}:${cleanPath}`, maxRequests, 60)
    if (!result.success) {
      return NextResponse.json(
        { error: 'Trop de requêtes. Veuillez réessayer.' },
        { status: 429 }
      )
    }
  }

  // La page d'accueil (landing) est publique : /, /fr, /en, /ar
  const isPublicPage = cleanPath === '/' || PUBLIC_AUTH.some(p => cleanPath === p || cleanPath.startsWith(`${p}/`))
  const isPublicApi = PUBLIC_API_PATTERNS.some(p => cleanPath.startsWith(p))
  const sessionCookie = request.cookies.get('bello_session')?.value

  if (!sessionCookie && !isPublicPage && !isPublicApi) {
    if (cleanPath.startsWith('/api/')) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }
    return NextResponse.redirect(new URL(`/${locale}/login`, request.url))
  }

  // 1) Toujours supprimer les en-têtes d'identité envoyés par le client (anti-usurpation x-user-role, x-tenant-id…)
  const requestHeaders = stripIdentityHeaders(request.headers)

  if (sessionCookie) {
    // Fail closed : sans SESSION_SECRET valide, aucune session n'est acceptée.
    let secretKey: Uint8Array
    try {
      secretKey = getSessionSecretKey()
    } catch (err) {
      if (err instanceof MissingSessionSecretError) {
        console.error('[proxy] ' + err.message)
        return NextResponse.json(
          { error: 'Configuration serveur invalide : SESSION_SECRET manquant' },
          { status: 500 }
        )
      }
      throw err
    }
    try {
      const { payload } = await jwtVerify(sessionCookie, secretKey, { algorithms: ['HS256'], clockTolerance: 60 })
      if (typeof payload.sub === 'string' && payload.sub) {
        requestHeaders.set('x-user-id', payload.sub)
        if (typeof payload.email === 'string') requestHeaders.set('x-user-email', payload.email)
        if (typeof payload.role === 'string') requestHeaders.set('x-user-role', payload.role)
        if (typeof payload.tenantId === 'string' && payload.tenantId) requestHeaders.set('x-tenant-id', payload.tenantId)
        // Valeur d'en-tête : ASCII uniquement
        if (typeof payload.firstName === 'string') {
          requestHeaders.set('x-user-firstname', encodeURIComponent(payload.firstName))
        }
      }
    } catch {
      if (cleanPath.startsWith('/api/')) {
        return NextResponse.json({ error: 'Session expirée' }, { status: 401 })
      }
      const resp = NextResponse.redirect(new URL(`/${locale}/login`, request.url))
      resp.cookies.delete('bello_session')
      return resp
    }
  }

  // Langue de la requête pour next-intl (pas de middleware next-intl : sans cet en-tête,
  // getRequestConfig retombe sur 'fr' et /ar, /en s'affichaient en français).
  requestHeaders.set('X-NEXT-INTL-LOCALE', locale)

  // 2) Les routes reçoivent uniquement les en-têtes dérivés de la session vérifiée.
  return NextResponse.next({ request: { headers: requestHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|webm|vtt|pdf)$).*)'],
}
