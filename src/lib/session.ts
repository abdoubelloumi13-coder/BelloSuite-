import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import { cache } from 'react'
import { getSessionSecretKey } from './session-secret'

const SESSION_COOKIE_NAME = 'bello_session'
const SESSION_DURATION = 60 * 60 * 24 * 7 // 7 days

export const SESSION_COOKIE = SESSION_COOKIE_NAME

// Pas de repli : lève MissingSessionSecretError si SESSION_SECRET est absent.
function getSecretKey(): Uint8Array {
  return getSessionSecretKey()
}

export interface SessionPayload {
  id: string
  email: string
  role: string
  tenantId: string | null
  firstName: string
  /**
   * Cabinet comptable : présent quand un collaborateur de cabinet travaille dans le dossier d'un client.
   * `tenantId` est alors celui du client et `homeTenantId` celui de son propre compte (null s'il n'en a pas).
   * L'accès du cabinet est revérifié en base à chaque requête (voir api-auth / firm-access).
   */
  firmId?: string | null
  homeTenantId?: string | null
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .setSubject(payload.id)
    .sign(getSecretKey())
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  // Hors du try : un secret manquant doit produire une erreur claire, pas un simple "non connecté".
  const key = getSecretKey()
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], clockTolerance: 60 })
    return {
      id: payload.sub as string,
      email: payload.email as string,
      role: payload.role as string,
      tenantId: (payload.tenantId as string | null) || null,
      firstName: (payload.firstName as string) || '',
      ...(payload.firmId ? { firmId: payload.firmId as string, homeTenantId: (payload.homeTenantId as string | null) || null } : {}),
    }
  } catch {
    return null
  }
}

export async function createSessionCookie(payload: SessionPayload): Promise<void> {
  const cookieStore = await cookies()
  const token = await signSession(payload)
  const isProd = process.env.NODE_ENV === 'production'
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true, secure: isProd, sameSite: 'lax',
    maxAge: SESSION_DURATION, path: '/',
  })
}

export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!token) return null
  return verifySessionToken(token)
})

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
}

export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  return session
}

export function requireTenantAccess(session: SessionPayload, tenantId: string): void {
  if (session.role === 'SUPER_ADMIN') return
  if (session.tenantId !== tenantId) throw new Error('Forbidden')
}
