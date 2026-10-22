/**
 * Révocation des sessions : le JWT ne fait plus foi seul. À chaque requête API, l'identité est revérifiée
 * en base (cache mémoire court, par instance) :
 *  - l'utilisateur existe toujours et est actif ;
 *  - son rôle ACTUEL remplace celui figé dans le jeton (rétrogradation immédiate, à ~30 s près) ;
 *  - son entreprise n'a pas changé (sinon reconnexion) ;
 *  - l'entreprise effective n'est pas suspendue (Tenant.isActive) — sauf pour le SUPER_ADMIN ;
 *  - session démo : rôle plafonné à USER, drapeau `demo` (lecture seule pour les actions sensibles) ;
 *  - session cabinet dans le dossier d'un client : rôle dérivé de FirmMember.role (OWNER → ADMIN, sinon USER + firmRole).
 *
 * `evaluateSession` est pure (testée) ; `loadLiveIdentity` / `loadTenantActive` lisent la base.
 */
import { prisma } from './db'
import type { SessionPayload } from './session'

/** Compte du tenant de démonstration (prisma/seed-demo.ts). */
export const DEMO_EMAIL = 'admin@demo.tn'

export const IDENTITY_CACHE_TTL_MS = 30_000

export interface LiveIdentity {
  email: string
  role: string
  tenantId: string | null
  isActive: boolean
}

type CacheEntry<T> = { at: number; value: T }
const userCache = new Map<string, CacheEntry<LiveIdentity | null>>()
const tenantCache = new Map<string, CacheEntry<boolean | null>>()
const MAX_CACHE = 5000

function cacheGet<T>(m: Map<string, CacheEntry<T>>, k: string): T | undefined {
  const e = m.get(k)
  if (!e) return undefined
  if (Date.now() - e.at > IDENTITY_CACHE_TTL_MS) { m.delete(k); return undefined }
  return e.value
}
function cacheSet<T>(m: Map<string, CacheEntry<T>>, k: string, value: T) {
  if (m.size >= MAX_CACHE) m.clear()
  m.set(k, { at: Date.now(), value })
}

/** À appeler après une désactivation / un changement de rôle / une suspension pour un effet immédiat sur cette instance. */
export function invalidateIdentityCache(opts: { email?: string | null; tenantId?: string | null } = {}) {
  if (!opts.email && !opts.tenantId) { userCache.clear(); tenantCache.clear(); return }
  if (opts.email) userCache.delete(opts.email.trim().toLowerCase())
  if (opts.tenantId) tenantCache.delete(opts.tenantId)
}

/** Utilisateur applicatif par e-mail (l'id du jeton peut être l'id Supabase ou l'id Prisma : l'e-mail est unique). */
export async function loadLiveIdentity(email: string): Promise<LiveIdentity | null> {
  const key = (email || '').trim().toLowerCase()
  if (!key) return null
  const hit = cacheGet(userCache, key)
  if (hit !== undefined) return hit
  const u = await prisma.user.findFirst({
    where: { email: { equals: key, mode: 'insensitive' } },
    select: { email: true, role: true, tenantId: true, isActive: true },
  })
  const value: LiveIdentity | null = u
    ? { email: u.email, role: String(u.role), tenantId: u.tenantId ?? null, isActive: u.isActive }
    : null
  cacheSet(userCache, key, value)
  return value
}

/** true/false selon Tenant.isActive ; null si le tenant n'existe pas. */
export async function loadTenantActive(tenantId: string): Promise<boolean | null> {
  const hit = cacheGet(tenantCache, tenantId)
  if (hit !== undefined) return hit
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { isActive: true } })
  const value = t ? t.isActive : null
  cacheSet(tenantCache, tenantId, value)
  return value
}

export function isFirmClientSession(s: Pick<SessionPayload, 'firmId' | 'tenantId' | 'homeTenantId'>): boolean {
  return !!s.firmId && s.tenantId !== (s.homeTenantId ?? null)
}

/** Rôle effectif d'un collaborateur de cabinet dans le dossier d'un client (jamais ADMIN pour un STAFF). */
export function firmEffectiveRole(firmRole: string | null | undefined): 'ADMIN' | 'USER' {
  return firmRole === 'OWNER' ? 'ADMIN' : 'USER'
}

export type SessionVerdict = { session: SessionPayload } | { error: string; status: number }

/**
 * Logique pure : confronte le jeton à l'état courant en base.
 * @param live        utilisateur en base (null = supprimé)
 * @param tenantActive état du tenant effectif (session.tenantId après correction) ; undefined = pas de tenant
 */
export function evaluateSession(
  session: SessionPayload,
  live: LiveIdentity | null,
  tenantActive: boolean | null | undefined
): SessionVerdict {
  if (!live) return { error: 'Session expirée, reconnectez-vous', status: 401 }
  if (!live.isActive) return { error: 'Compte désactivé', status: 401 }

  const next: SessionPayload = { ...session }
  const firmClient = isFirmClientSession(session)

  if (firmClient) {
    // Le rôle vient de FirmMember (appliqué dans requireTenant) ; ici, l'utilisateur ne peut pas devenir plus qu'ADMIN.
    next.role = firmEffectiveRole(session.firmRole)
    if ((session.homeTenantId ?? null) !== live.tenantId) return { error: 'Session expirée, reconnectez-vous', status: 401 }
  } else {
    next.role = live.role
    if (live.role !== 'SUPER_ADMIN' && (session.tenantId ?? null) !== live.tenantId) {
      // Changement d'entreprise (ou retrait) depuis l'émission du jeton
      return { error: 'Session expirée, reconnectez-vous', status: 401 }
    }
  }

  if (live.email.trim().toLowerCase() === DEMO_EMAIL) {
    next.demo = true
    if (next.role === 'ADMIN' || next.role === 'SUPER_ADMIN') next.role = 'USER'
  } else if (next.demo) {
    delete next.demo
  }

  if (next.tenantId && next.role !== 'SUPER_ADMIN') {
    if (tenantActive === null) return { error: 'Entreprise introuvable', status: 403 }
    if (tenantActive === false) return { error: 'Entreprise suspendue : contactez le support BelloSuite', status: 403 }
  }
  return { session: next }
}

/** Revérifie une session déjà décodée (JWT valide). */
export async function checkSessionLive(session: SessionPayload): Promise<SessionVerdict> {
  const live = await loadLiveIdentity(session.email)
  const tenantActive = session.tenantId ? await loadTenantActive(session.tenantId) : undefined
  return evaluateSession(session, live, tenantActive)
}

const demoTenantCache: { at: number; value: string | null } = { at: 0, value: null }

/**
 * true si `tenantId` est le tenant du compte de démonstration publique (aucun envoi sortant depuis ce tenant).
 * Cache par instance (TTL identique à l'identité).
 */
export async function isDemoTenant(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false
  if (Date.now() - demoTenantCache.at > IDENTITY_CACHE_TTL_MS) {
    try {
      const u = await prisma.user.findFirst({ where: { email: { equals: DEMO_EMAIL, mode: 'insensitive' } }, select: { tenantId: true } })
      demoTenantCache.value = u?.tenantId ?? null
      demoTenantCache.at = Date.now()
    } catch (e) {
      console.warn('[session-guard] tenant démo non déterminé', (e as Error)?.message)
      return false
    }
  }
  return demoTenantCache.value === tenantId
}
