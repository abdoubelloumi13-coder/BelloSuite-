import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getApiContext, type ApiContext } from '@/lib/api'
import { requireAccess, forbiddenResponse } from '@/lib/rbac'

/** Id Prisma de l'acteur (le jeton peut porter l'id Supabase : l'e-mail est unique). */
export async function actorPrismaId(email: string): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })
  return u?.id ?? null
}

/**
 * Contexte de l'admin d'entreprise pour la gestion des utilisateurs : rôle ADMIN de l'entreprise
 * (ou super admin), jamais en session démo ni depuis le dossier client d'un cabinet comptable.
 */
export async function getUserAdminContext(req: NextRequest): Promise<ApiContext | NextResponse> {
  const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
  if (ctx instanceof NextResponse) return ctx
  const denied = requireAccess(ctx, 'users:manage')
  if (denied) return denied
  if (ctx.userRole !== 'SUPER_ADMIN' && ctx.user?.firmId) {
    return forbiddenResponse('La gestion des utilisateurs est réservée à l\'administrateur de l\'entreprise')
  }
  return ctx
}
