import { prisma } from '@/lib/db'

/**
 * Source de vérité unique pour le rôle et le tenant d'un utilisateur : la table `User` (Prisma, côté serveur).
 *
 * SÉCURITÉ : ne JAMAIS lire `role` / `tenant_id` dans `user_metadata` Supabase — ce champ est
 * modifiable par l'utilisateur lui-même (`supabase.auth.updateUser({ data: ... })` avec la clé anon).
 * Aucun repli vers « le premier tenant actif » : un utilisateur sans tenant reste sans tenant (onboarding).
 */
export interface DbIdentity {
  role: string
  tenantId: string | null
  firstName: string
  isActive: boolean
  /** Tenant.isActive (null si l'utilisateur n'a pas d'entreprise). Une entreprise suspendue ne peut plus se connecter. */
  tenantActive: boolean | null
}

export async function resolveIdentityFromDb(
  email: string,
  defaults: { firstName?: string; lastName?: string } = {}
): Promise<DbIdentity> {
  const normalized = email.trim().toLowerCase()
  let dbUser =
    (await prisma.user.findUnique({ where: { email } })) ??
    (normalized !== email ? await prisma.user.findUnique({ where: { email: normalized } }) : null)

  if (!dbUser) {
    // Premier login : compte applicatif minimal, rôle USER, sans tenant (→ onboarding).
    dbUser = await prisma.user.create({
      data: {
        email: normalized,
        firstName: defaults.firstName || '',
        lastName: defaults.lastName || '',
        password: 'SUPABASE_AUTH', // le mot de passe est géré par Supabase Auth, jamais ici
        role: 'USER',
        isActive: true,
      },
    })
  }

  let tenantActive: boolean | null = null
  if (dbUser.tenantId) {
    const t = await prisma.tenant.findUnique({ where: { id: dbUser.tenantId }, select: { isActive: true } })
    tenantActive = t ? t.isActive : false
  }

  return {
    tenantActive,
    role: dbUser.role,
    tenantId: dbUser.tenantId ?? null,
    firstName: dbUser.firstName || '',
    isActive: dbUser.isActive,
  }
}
