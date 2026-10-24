/**
 * Gestion des utilisateurs par l'administrateur d'une entreprise : schémas et règles (pures, testables).
 * L'admin d'entreprise ne voit et ne modifie que les comptes de SON entreprise, jamais un SUPER_ADMIN,
 * ne crée jamais de SUPER_ADMIN, et ne peut pas se retirer lui-même les droits (ni retirer le dernier admin actif).
 */
import { z } from 'zod'

export const TENANT_ROLES = ['ADMIN', 'USER'] as const
export type TenantRole = typeof TENANT_ROLES[number]

export const tenantCreateUserSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'E-mail invalide' }).max(254),
  password: z.string().min(10, { message: 'Mot de passe : 10 caractères minimum' }).max(128),
  firstName: z.string().trim().max(80).optional().default(''),
  lastName: z.string().trim().max(80).optional().default(''),
  role: z.enum(TENANT_ROLES).default('USER'),
}).strict()

export const tenantUpdateUserSchema = z.object({
  firstName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  role: z.enum(TENANT_ROLES).optional(),
  isActive: z.boolean().optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'Aucune modification' })

export type TenantUpdateUser = z.infer<typeof tenantUpdateUserSchema>

export interface TargetUser { id: string; email: string; role: string; isActive: boolean; tenantId: string | null }

/**
 * Vérifie qu'une modification est permise. Renvoie un message d'erreur (refus) ou null (autorisé).
 * activeAdmins = nombre d'ADMIN actifs de l'entreprise AVANT la modification.
 */
export function checkTenantUserChange(opts: {
  actorEmail: string
  tenantId: string
  target: TargetUser
  change: TenantUpdateUser
  activeAdmins: number
}): string | null {
  const { actorEmail, tenantId, target, change, activeAdmins } = opts
  if (target.tenantId !== tenantId) return 'Utilisateur introuvable'
  if (target.role === 'SUPER_ADMIN') return 'Ce compte ne peut pas être modifié depuis votre entreprise'
  const self = target.email.trim().toLowerCase() === actorEmail.trim().toLowerCase()
  const losesAdmin = target.role === 'ADMIN' && target.isActive &&
    ((change.role !== undefined && change.role !== 'ADMIN') || change.isActive === false)
  if (self && change.isActive === false) return 'Vous ne pouvez pas désactiver votre propre compte'
  if (self && losesAdmin) return 'Vous ne pouvez pas retirer vos propres droits d\'administrateur'
  if (losesAdmin && activeAdmins <= 1) return 'Il doit rester au moins un administrateur actif'
  return null
}

/** Indicateurs du tableau de bord. */
export function userStats(users: Array<{ role: string; isActive: boolean }>) {
  const active = users.filter(u => u.isActive)
  return {
    total: users.length,
    active: active.length,
    inactive: users.length - active.length,
    admins: active.filter(u => u.role === 'ADMIN').length,
  }
}
