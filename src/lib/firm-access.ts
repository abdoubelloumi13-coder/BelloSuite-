/**
 * Accès des cabinets comptables aux dossiers clients (accès base).
 * La logique pure (codes, échéances, indicateurs, CSV) est dans firm-logic.ts.
 */
import { prisma } from '@/lib/db'
import type { SessionPayload } from '@/lib/session'

export type FirmMembership = { firmId: string; role: string; firm: { id: string; name: string; matriculeFiscal: string | null } }

/** Cabinet dont l'utilisateur est membre (un seul cabinet par utilisateur dans cette version). */
export async function getFirmMembership(userId: string): Promise<FirmMembership | null> {
  const m = await prisma.firmMember.findFirst({
    where: { userId },
    select: { firmId: true, role: true, firm: { select: { id: true, name: true, matriculeFiscal: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return m ?? null
}

/** true si le cabinet a un accès ACTIF au dossier. */
export async function firmHasActiveAccess(firmId: string, tenantId: string): Promise<boolean> {
  const n = await prisma.firmClientAccess.count({ where: { firmId, tenantId, status: 'ACTIVE' } })
  return n > 0
}

/**
 * Une session « cabinet dans le dossier d'un client » reste valable tant que (1) l'utilisateur est toujours
 * membre du cabinet et (2) l'accès au dossier n'a pas été révoqué. Revérifié à chaque requête (révocation immédiate).
 */
export async function firmSessionStillValid(session: Pick<SessionPayload, 'id' | 'firmId' | 'tenantId' | 'homeTenantId'>): Promise<boolean> {
  if (!session.firmId) return true
  if (!session.tenantId) return false
  if (session.homeTenantId && session.tenantId === session.homeTenantId) return true
  const [member, access] = await Promise.all([
    prisma.firmMember.count({ where: { firmId: session.firmId, userId: session.id } }),
    prisma.firmClientAccess.count({ where: { firmId: session.firmId, tenantId: session.tenantId, status: 'ACTIVE' } }),
  ])
  return member > 0 && access > 0
}
