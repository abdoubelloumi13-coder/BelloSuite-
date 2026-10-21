/**
 * Contrôle de rôle À L'INTÉRIEUR d'une entreprise (après requireTenant / getApiContext).
 *
 * Rôles existants (prisma enum UserRole) : SUPER_ADMIN, ADMIN, USER.
 *  - ADMIN : dirigeant / gestionnaire → tout.
 *  - USER  : caissier POS, magasinier, commercial → pas de paie/RH, pas d'écritures comptables,
 *            pas de paramètres (TTN, e-facture, entreprise), pas de gestion des utilisateurs.
 *  - Collaborateur de cabinet STAFF dans le dossier d'un client : paie/RH et comptabilité (son métier),
 *    jamais les paramètres ni les utilisateurs. OWNER du cabinet = ADMIN.
 *  - Session démo publique : lecture seule sur ces zones, aucune action sortante (e-mail/WhatsApp).
 *
 * Usage :
 *   const denied = requireAccess(ctx, 'hr:write'); if (denied) return denied
 */
import { NextResponse } from 'next/server'
import type { TenantContext } from './api-auth'

export type Access =
  | 'hr:read'          // fiches de paie, salaires, CIN, paramètres de paie
  | 'hr:write'
  | 'accounting:write' // écritures, plan comptable, clôtures, déclarations
  | 'settings:write'   // identifiants TTN/ASP, paramètres e-facture, fiche entreprise
  | 'users:manage'
  | 'outbound:send'    // relances e-mail / WhatsApp envoyées au nom de l'entreprise

type Ctx = Pick<TenantContext, 'userRole'> & { user: { role?: string; firmRole?: string | null; demo?: boolean; firmId?: string | null } }

const FIRM_STAFF: Access[] = ['hr:read', 'hr:write', 'accounting:write', 'outbound:send']
const DEMO_READ: Access[] = ['hr:read']

export function canAccess(ctx: Ctx, access: Access): boolean {
  const role = ctx.userRole
  if (role === 'SUPER_ADMIN') return true
  if (ctx.user?.demo) return DEMO_READ.includes(access)
  if (role === 'ADMIN') return true
  if (ctx.user?.firmId && ctx.user?.firmRole && ctx.user.firmRole !== 'OWNER') return FIRM_STAFF.includes(access)
  return false
}

export function forbiddenResponse(message = 'Accès refusé : droits insuffisants pour cette action') {
  return NextResponse.json({ error: message }, { status: 403 })
}

/** null si autorisé, sinon une réponse 403. */
export function requireAccess(ctx: Ctx, access: Access): NextResponse | null {
  if (canAccess(ctx, access)) return null
  if (ctx.user?.demo) return forbiddenResponse('Action indisponible en mode démo')
  return forbiddenResponse()
}

/** null si le rôle effectif est dans la liste (SUPER_ADMIN toujours admis), sinon 403. */
export function requireTenantRole(ctx: Ctx, roles: Array<'ADMIN' | 'USER'>): NextResponse | null {
  if (ctx.userRole === 'SUPER_ADMIN') return null
  if (ctx.user?.demo) return forbiddenResponse('Action indisponible en mode démo')
  return (roles as string[]).includes(ctx.userRole) ? null : forbiddenResponse()
}

/** Écriture interdite depuis la session démo (défacement, spam). */
export function denyDemo(ctx: { user: { demo?: boolean } }): NextResponse | null {
  return ctx.user?.demo ? forbiddenResponse('Action indisponible en mode démo') : null
}
