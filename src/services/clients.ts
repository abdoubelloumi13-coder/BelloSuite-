import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { optionalText, optionalEmail } from '@/lib/zod-helpers'

// ─── Zod Schemas ────────────────────────────────────────────

const clientFields = {
  code: optionalText(),
  name: z.string().trim().min(1, 'nom requis'),
  email: optionalEmail(),
  phone: optionalText(),
  address: optionalText(),
  city: optionalText(),
  zipCode: optionalText(),
  matriculeFiscal: optionalText(),
}

export const createClientSchema = z.object({
  tenantId: z.string().min(1, 'tenantId requis'),
  ...clientFields,
  country: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined), z.string().default('Tunisie')),
  isActive: z.boolean().default(true),
})

// Mise à jour : mêmes règles, sans valeurs par défaut (un champ absent n'est pas modifié)
export const updateClientSchema = z.object({
  ...clientFields,
  country: optionalText(),
  isActive: z.boolean().optional(),
}).partial()

export type CreateClientData = z.infer<typeof createClientSchema>
export type UpdateClientData = z.infer<typeof updateClientSchema>

// ─── Service Functions ──────────────────────────────────────

export async function getClients(tenantId: string, activeOnly = false) {
  return prisma.client.findMany({
    where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: { name: 'asc' },
  })
}

export async function getClientById(id: string, tenantId: string) {
  const client = await prisma.client.findUnique({ where: { id } })
  if (!client || client.tenantId !== tenantId) {
    throw new BusinessError('Client introuvable', 404)
  }
  return client
}

export async function createClient(data: CreateClientData) {
  const { tenantId, code, name, email, phone, address, city, zipCode, country, matriculeFiscal } = data

  // Auto-generate code if not provided
  const finalCode = code?.trim() || `CLT-${Date.now().toString(36).toUpperCase()}`

  // Check uniqueness of code within tenant
  const existing = await prisma.client.findUnique({
    where: { tenantId_code: { tenantId, code: finalCode } },
    select: { id: true },
  })
  if (existing) {
    throw new BusinessError(`Code client "${finalCode}" déjà utilisé`, 409)
  }

  return prisma.client.create({
    data: {
      tenantId,
      code: finalCode,
      name,
      email: email ?? null,
      phone: phone ?? null,
      address: address ?? null,
      city: city ?? null,
      zipCode: zipCode ?? null,
      country,
      matriculeFiscal: matriculeFiscal ?? null,
    },
  })
}

export async function updateClient(id: string, tenantId: string, data: UpdateClientData) {
  await getClientById(id, tenantId) // throws 404 if not found/wrong tenant

  const { code, country, ...rest } = data
  return prisma.client.update({
    where: { id },
    data: {
      ...rest,
      ...(code ? { code } : {}),
      ...(country ? { country } : {}),
    },
  })
}

export async function deleteClient(id: string, tenantId: string) {
  await getClientById(id, tenantId)

  // Check for linked invoices before deleting
  const invoiceCount = await prisma.invoice.count({ where: { clientId: id } })
  if (invoiceCount > 0) {
    throw new BusinessError(
      `Impossible de supprimer ce client : ${invoiceCount} facture(s) associée(s)`,
      409
    )
  }

  return prisma.client.delete({ where: { id } })
}
