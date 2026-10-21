import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { UserRole } from '@prisma/client'

// ─── Zod Schemas ────────────────────────────────────────────

export const createTenantSchema = z.object({
  companyName: z.string().min(1),
  subdomain: z.string().optional().nullable(),
  matriculeFiscal: z.string().optional().nullable(),
  vatNumber: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  userEmail: z.string().email().optional().nullable(),
})

export type CreateTenantData = z.infer<typeof createTenantSchema>

// ─── Service Functions ──────────────────────────────────────

export async function getTenants(requestingUserRole: UserRole) {
  if (requestingUserRole !== UserRole.SUPER_ADMIN) {
    throw new BusinessError('Accès réservé au Super Admin', 403)
  }

  return prisma.tenant.findMany({
    include: {
      users: { 
        where: { isActive: true }, 
        select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true } 
      },
      modules: { include: { module: true } }
    },
    orderBy: { createdAt: 'desc' }
  })
}

export async function createTenant(data: CreateTenantData, requestingUserRole: UserRole) {
  if (requestingUserRole !== UserRole.SUPER_ADMIN) {
    throw new BusinessError('Accès réservé au Super Admin', 403)
  }

  const { companyName, subdomain, userEmail, ...rest } = data

  // 1. Generate subdomain
  const generatedSubdomain = subdomain 
    ? subdomain.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20)
    : companyName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 20) + '-' + Date.now().toString(36)

  return prisma.$transaction(async (tx) => {
    // 2. Create tenant
    const tenant = await tx.tenant.create({
      data: {
        name: companyName,
        subdomain: generatedSubdomain,
        ...rest,
        isActive: true
      }
    })

    // 3. Assign default modules
    const defaultModules = await tx.module.findMany({
      where: { name: { in: ['Stock', 'Commercial', 'Accounting'] } }
    })
    
    if (defaultModules.length > 0) {
      await tx.tenantModule.createMany({
        data: defaultModules.map(m => ({
          tenantId: tenant.id,
          moduleId: m.id,
          isEnabled: true
        }))
      })
    }

    // 4. Link user if provided
    if (userEmail) {
      await tx.user.update({
        where: { email: userEmail },
        data: { 
          tenantId: tenant.id,
          role: UserRole.ADMIN
        }
      })
    }

    return tenant
  })
}

export const SAFE_USER_SELECT = {
  id: true, email: true, firstName: true, lastName: true, role: true, tenantId: true,
  isActive: true, createdAt: true, updatedAt: true,
  tenant: { select: { id: true, name: true, subdomain: true, isActive: true } },
} as const

export async function getAllUsers(
  requestingUserRole: UserRole,
  filters: { tenantId?: string | null; query?: string | null; take?: number } = {}
) {
  if (requestingUserRole !== UserRole.SUPER_ADMIN) {
    throw new BusinessError('Accès réservé au Super Admin', 403)
  }
  const where: Record<string, unknown> = {}
  if (filters.tenantId) where.tenantId = filters.tenantId
  const q = filters.query?.trim()
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ]
  }
  // Jamais le champ password ; volume borné.
  return prisma.user.findMany({
    where,
    select: SAFE_USER_SELECT,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(filters.take ?? 500, 1), 1000),
  })
}

export const createUserSchema = z.object({
  tenantId: z.string().uuid({ message: 'Entreprise invalide' }),
  email: z.string().trim().toLowerCase().email({ message: 'E-mail invalide' }).max(254),
  password: z.string().min(10, { message: 'Mot de passe : 10 caractères minimum' }).max(128),
  firstName: z.string().trim().max(80).optional().default(''),
  lastName: z.string().trim().max(80).optional().default(''),
  // SUPER_ADMIN ne se crée pas depuis l'interface
  role: z.enum(['ADMIN', 'USER']).default('USER'),
}).strict()

export type CreateUserData = z.infer<typeof createUserSchema>
