/**
 * Garde-fous d'API côté serveur — UNIQUE point d'entrée pour l'authentification des routes.
 *
 * Règles :
 *  - L'identité vient exclusivement du cookie signé `bello_session` (vérifié ici, indépendamment du proxy).
 *  - Le tenant vient de la session. Un `tenantId` envoyé par le client (query/body) n'est jamais
 *    utilisé tel quel : s'il diffère de celui de la session → 403. Seul SUPER_ADMIN peut cibler un autre tenant.
 *  - Les en-têtes x-user-* / x-tenant-id ne sont jamais lus ici.
 *
 * Usage :
 *   const ctx = await requireTenant(req, searchParams.get('tenantId'))
 *   if (ctx instanceof NextResponse) return ctx
 *   prisma.x.findMany({ where: { tenantId: ctx.tenantId } })
 */
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { verifySessionToken, getSession, type SessionPayload } from './session'
import { MissingSessionSecretError } from './session-secret'
import { checkSessionLive, isFirmClientSession, firmEffectiveRole } from './session-guard'

export const SESSION_COOKIE_NAME = 'bello_session'

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'USER'

export interface TenantContext {
  user: SessionPayload
  tenantId: string
  userRole: string
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '' || v === 'null' || v === 'undefined'
}

/** Vérifie le cookie de session. Renvoie la session ou une réponse 401/500. */
export async function requireSession(req?: NextRequest | Request): Promise<SessionPayload | NextResponse> {
  try {
    let session: SessionPayload | null = null
    const cookieToken = req && 'cookies' in req ? (req as NextRequest).cookies?.get(SESSION_COOKIE_NAME)?.value : undefined
    if (cookieToken) {
      session = await verifySessionToken(cookieToken)
    } else {
      session = await getSession()
    }
    if (!session || !session.id) return jsonError('Non authentifié', 401)
    // Révocation : utilisateur actif, rôle actuel, entreprise non suspendue (revérifiés en base, cache court).
    let verdict
    try {
      verdict = await checkSessionLive(session)
    } catch (dbErr) {
      console.error('[api-auth] revalidation de session impossible (base indisponible ?)', dbErr)
      return jsonError('Service momentanément indisponible', 503)
    }
    if ('error' in verdict) return jsonError(verdict.error, verdict.status)
    return verdict.session
  } catch (err) {
    if (err instanceof MissingSessionSecretError) {
      console.error('[api-auth] ' + err.message)
      return jsonError('Configuration serveur invalide : SESSION_SECRET manquant', 500)
    }
    return jsonError('Non authentifié', 401)
  }
}

/**
 * Pour les composants serveur (layouts) : session vérifiée ET revalidée en base, ou null.
 * Ne lève pas : un problème de base → null (l'utilisateur est renvoyé vers la connexion).
 */
export async function getLiveSession(): Promise<SessionPayload | null> {
  try {
    const session = await getSession()
    if (!session || !session.id) return null
    const verdict = await checkSessionLive(session)
    return 'error' in verdict ? null : verdict.session
  } catch {
    return null
  }
}

/**
 * Logique pure (testable) : calcule le tenant effectif à partir de la session et
 * de l'éventuel tenantId demandé par le client.
 */
export function resolveTenantContext(
  session: SessionPayload,
  requestedTenantId?: string | null
): TenantContext | { error: string; status: number } {
  const requested = isBlank(requestedTenantId) ? null : String(requestedTenantId)

  if (session.role === 'SUPER_ADMIN') {
    const tenantId = requested ?? session.tenantId
    if (!tenantId) return { error: 'tenantId requis', status: 400 }
    return { user: session, tenantId, userRole: session.role }
  }

  if (!session.tenantId) {
    return { error: 'Aucune entreprise associée à ce compte', status: 403 }
  }
  if (requested && requested !== session.tenantId) {
    return { error: 'Accès refusé', status: 403 }
  }
  return { user: session, tenantId: session.tenantId, userRole: session.role }
}

/** Session + tenant obligatoires. `requestedTenantId` est seulement comparé, jamais cru. */
export async function requireTenant(
  req: NextRequest | Request | undefined,
  requestedTenantId?: string | null
): Promise<TenantContext | NextResponse> {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session
  const ctx = resolveTenantContext(session, requestedTenantId)
  if ('error' in ctx) return jsonError(ctx.error, ctx.status)
  // Collaborateur de cabinet dans le dossier d'un client : accès revérifié en base (révocation immédiate)
  // Le rôle dans le dossier est dérivé du rôle ACTUEL dans le cabinet (OWNER → ADMIN, STAFF → USER limité).
  if (isFirmClientSession(session)) {
    const { firmSessionRole } = await import('./firm-access')
    const firmRole = await firmSessionRole(session)
    if (!firmRole) return jsonError('Accès du cabinet révoqué', 403)
    const role = firmEffectiveRole(firmRole)
    return { user: { ...ctx.user, role, firmRole }, tenantId: ctx.tenantId, userRole: role }
  }
  return ctx
}

export function hasRole(session: Pick<SessionPayload, 'role'>, roles: Role[]): boolean {
  return roles.includes(session.role as Role)
}

/** Session + rôle obligatoires (ex. requireRole(req, ['SUPER_ADMIN'])). */
export async function requireRole(
  req: NextRequest | Request | undefined,
  roles: Role[]
): Promise<SessionPayload | NextResponse> {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session
  if (!hasRole(session, roles)) return jsonError('Accès refusé', 403)
  return session
}

export const requireSuperAdmin = (req?: NextRequest | Request) => requireRole(req, ['SUPER_ADMIN'])

/**
 * Routes /api/cron/* : exige `Authorization: Bearer <CRON_SECRET>` (format utilisé par Vercel Cron)
 * ou `x-cron-secret: <CRON_SECRET>`. Renvoie null si OK, sinon la réponse d'erreur.
 */
export function checkCronSecret(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) {
    console.error('[cron] CRON_SECRET manquant ou trop court : requête refusée')
    return jsonError('CRON_SECRET non configuré', 500)
  }
  const auth = req.headers.get('authorization') || ''
  const provided = auth.startsWith('Bearer ') ? auth.slice(7) : req.headers.get('x-cron-secret') || ''
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return jsonError('Non autorisé', 401)
  return null
}

/** Routes de debug/seed : désactivées en production. */
export function denyInProduction(): NextResponse | null {
  if (process.env.NODE_ENV === 'production') return jsonError('Non disponible', 404)
  return null
}
