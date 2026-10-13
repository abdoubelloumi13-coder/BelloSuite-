import { prisma } from '@/lib/db'

/**
 * Trace une action sensible d'un super admin dans l'audit log.
 * Ne doit jamais faire échouer l'action principale : en cas d'erreur, on log en console.
 */
export async function logAudit(
  adminId: string,
  action: string,
  opts: { target?: string; targetId?: string; tenantId?: string | null; details?: any; ip?: string | null } = {}
) {
  try {
    await prisma.auditLog.create({
      data: {
        adminId,
        action,
        target: opts.target ?? null,
        targetId: opts.targetId ?? null,
        tenantId: opts.tenantId ?? null,
        details: opts.details ? JSON.parse(JSON.stringify(opts.details)) : undefined,
        ip: opts.ip ?? null,
      },
    })
  } catch (e) {
    console.error('[audit] échec de la journalisation', e)
  }
}

/** Extrait l'IP client depuis les headers (x-forwarded-for en production). */
export function clientIp(req: Request | any): string | null {
  const xf = req.headers?.get?.('x-forwarded-for') || req.headers?.get?.('x-real-ip')
  return xf ? String(xf).split(',')[0].trim() : null
}
