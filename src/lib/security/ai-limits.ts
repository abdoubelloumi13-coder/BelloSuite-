/**
 * Limites de débit des endpoints IA / embeddings (audit E6/E7), partagées entre instances (table RateLimit).
 *  - par entreprise : quota horaire propre à chaque endpoint (inchangé) ;
 *  - par utilisateur : la moitié du quota de l'entreprise (un seul compte ne vide pas le quota de tous) ;
 *  - démo publique (session partagée par tous les visiteurs) : quota horaire plafonné, 5 appels / heure / IP
 *    et 100 appels / jour pour tout le tenant démo, tous endpoints IA confondus.
 */
import type { NextResponse } from 'next/server'
import { enforceRateLimits, clientIp } from '@/lib/rate-limit-persistent'

export const DEMO_AI_PER_IP_HOUR = 5
export const DEMO_AI_TENANT_HOURLY_CAP = 20
export const DEMO_AI_TENANT_DAY = 100

type AiCtx = { tenantId: string; user?: { id?: string; demo?: boolean } | null }
export type Limit = { key: string; max: number; windowSeconds: number }

/** Logique pure (testée) : liste des compteurs à incrémenter pour un appel. */
export function aiLimits(ctx: AiCtx, ip: string, name: string, tenantPerHour: number): Limit[] {
  const demo = !!ctx.user?.demo
  const tenantMax = demo ? Math.min(tenantPerHour, DEMO_AI_TENANT_HOURLY_CAP) : tenantPerHour
  const limits: Limit[] = [{ key: `${name}:tenant:${ctx.tenantId}`, max: tenantMax, windowSeconds: 3600 }]
  if (demo) {
    // La session démo est partagée (même utilisateur pour tous) → bornes par IP et globale journalière
    limits.push(
      { key: `ai-demo:ip:${ip}`, max: DEMO_AI_PER_IP_HOUR, windowSeconds: 3600 },
      { key: `ai-demo:tenant:${ctx.tenantId}:day`, max: DEMO_AI_TENANT_DAY, windowSeconds: 86400 },
    )
  } else if (ctx.user?.id) {
    limits.push({ key: `${name}:user:${ctx.user.id}`, max: Math.max(1, Math.ceil(tenantMax / 2)), windowSeconds: 3600 })
  }
  return limits
}

/** Réponse 429 si une limite est dépassée, sinon null. */
export function enforceAiLimits(req: Request, ctx: AiCtx, name: string, tenantPerHour: number): Promise<NextResponse | null> {
  return enforceRateLimits(aiLimits(ctx, clientIp(req), name, tenantPerHour))
}
