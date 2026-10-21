import { safeErrorMessage } from '@/lib/security/import-limits'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'

// ─── Zod Schemas ────────────────────────────────────────────
export const createLeadSchema = z.object({
  tenantId: z.string().min(1, 'tenantId requis'),
  code: z.string().optional(),
  name: z.string().min(1, 'nom requis'),
  company: z.string().optional().nullable(),
  email: z.string().email('email invalide').optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  sector: z.enum(['GARAGE', 'PME_INDUSTRIE', 'COMMERCE', 'SERVICES', 'AUTO_ENTREPRENEUR', 'AUTRE']).default('AUTRE'),
  source: z.enum(['WEBSITE', 'LINKEDIN', 'WHATSAPP', 'EMAIL', 'REFERRAL', 'COLD_CALL', 'EVENT', 'OTHER']).default('OTHER'),
  status: z.enum(['NOUVEAU', 'CONTACTE', 'DEMO', 'NEGOCIATION', 'GAGNE', 'PERDU']).default('NOUVEAU'),
  estimatedValue: z.number().optional().nullable(),
  nextFollowUp: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export const updateLeadSchema = createLeadSchema.partial().omit({ tenantId: true })

export type CreateLeadData = z.infer<typeof createLeadSchema>
export type UpdateLeadData = z.infer<typeof updateLeadSchema>

// Lead Note schemas
export const createLeadNoteSchema = z.object({
  tenantId: z.string().min(1, 'tenantId requis'),
  leadId: z.string().min(1, 'leadId requis'),
  content: z.string().min(1, 'contenu requis'),
  author: z.string().optional().nullable(),
})

export type CreateLeadNoteData = z.infer<typeof createLeadNoteSchema>

// ─── Service Functions ──────────────────────────────────────

export async function getLeads(tenantId: string, filters?: { status?: string; sector?: string; city?: string; search?: string }) {
  const where: any = { tenantId }
  if (filters?.status) where.status = filters.status
  if (filters?.sector) where.sector = filters.sector
  if (filters?.city) where.city = filters.city
  if (filters?.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { company: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
      { phone: { contains: filters.search, mode: 'insensitive' } },
      { code: { contains: filters.search, mode: 'insensitive' } },
    ]
  }

  return prisma.lead.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { leadNotes: true } } },
  })
}

export async function getLeadById(id: string, tenantId: string) {
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      leadNotes: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  })
  if (!lead || lead.tenantId !== tenantId) {
    throw new BusinessError('Lead introuvable', 404)
  }
  return lead
}

export async function createLead(data: CreateLeadData) {
  const { tenantId, code, name, company, email, phone, address, city, zipCode, sector, source, status, estimatedValue, nextFollowUp, notes } = data

  // Auto-generate code if not provided
  const finalCode = code?.trim() || `LEAD-${Date.now().toString(36).toUpperCase()}`

  // Check uniqueness of code within tenant
  const existing = await prisma.lead.findUnique({
    where: { tenantId_code: { tenantId, code: finalCode } },
    select: { id: true },
  })
  if (existing) {
    throw new BusinessError(`Code lead "${finalCode}" déjà utilisé`, 409)
  }

  return prisma.lead.create({
    data: {
      tenantId,
      code: finalCode,
      name,
      company: company ?? null,
      email: email ?? null,
      phone: phone ?? null,
      address: address ?? null,
      city: city ?? null,
      zipCode: zipCode ?? null,
      sector,
      source,
      status,
      estimatedValue: estimatedValue ?? null,
      nextFollowUp: nextFollowUp ? new Date(nextFollowUp) : null,
      notes: notes ?? null,
    },
  })
}

export async function updateLead(id: string, tenantId: string, data: UpdateLeadData) {
  const lead = await getLeadById(id, tenantId)

  // Check code uniqueness if changing
  if (data.code && data.code !== lead.code) {
    const existing = await prisma.lead.findUnique({
      where: { tenantId_code: { tenantId, code: data.code } },
      select: { id: true },
    })
    if (existing) {
      throw new BusinessError(`Code lead "${data.code}" déjà utilisé`, 409)
    }
  }

  return prisma.lead.update({
    where: { id },
    data: {
      ...data,
      estimatedValue: data.estimatedValue ?? undefined,
      nextFollowUp: data.nextFollowUp ? new Date(data.nextFollowUp) : null,
    },
  })
}

export async function deleteLead(id: string, tenantId: string) {
  await getLeadById(id, tenantId)
  return prisma.lead.delete({ where: { id } })
}

export async function bulkCreateLeads(tenantId: string, leads: CreateLeadData[]) {
  const results = []
  const errors = []

  for (const leadData of leads) {
    try {
      const lead = await createLead({ ...leadData, tenantId })
      results.push(lead)
    } catch (e: any) {
      errors.push({ code: leadData.code, error: safeErrorMessage(e) })
    }
  }

  return { imported: results.length, failed: errors.length, results, errors }
}

// Lead Notes
export async function getLeadNotes(leadId: string, tenantId: string) {
  const lead = await getLeadById(leadId, tenantId)
  return prisma.leadNote.findMany({
    where: { leadId, tenantId },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createLeadNote(data: CreateLeadNoteData) {
  const { tenantId, leadId, content, author } = data
  const lead = await getLeadById(leadId, tenantId)

  return prisma.leadNote.create({
    data: { tenantId, leadId, content, author: author ?? null },
  })
}

// Pipeline stats for Kanban
export async function getPipelineStats(tenantId: string) {
  const leads = await prisma.lead.groupBy({
    by: ['status'],
    where: { tenantId },
    _count: { status: true },
    _sum: { estimatedValue: true },
  })

  const stats: Record<string, { count: number; value: number }> = {}
  const statuses = ['NOUVEAU', 'CONTACTE', 'DEMO', 'NEGOCIATION', 'GAGNE', 'PERDU']
  statuses.forEach(s => { stats[s] = { count: 0, value: 0 } })

  for (const l of leads) {
    stats[l.status] = { count: l._count.status, value: Number(l._sum.estimatedValue || 0) }
  }

  return stats
}

// Import from CSV/Excel
export async function importLeadsFromCSV(tenantId: string, rows: any[], headerMap: Record<string, string>) {
  const REQUIRED = ['name']
  const log: any[] = []
  const errors: any[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNum = i + 2
    const get = (key: string) => {
      const h = headerMap[key.toLowerCase()]
      return h !== undefined ? row[h] : undefined
    }

    const name = String(get('name') || '').trim()
    if (!name) {
      errors.push({ row: rowNum, error: 'name manquant' })
      continue
    }

    const code = String(get('code') || '').trim() || `LEAD-${Date.now().toString(36).toUpperCase()}-${i}`

    try {
      const existing = await prisma.lead.findUnique({
        where: { tenantId_code: { tenantId, code } },
      })
      if (existing) {
        errors.push({ row: rowNum, code, error: 'Code déjà utilisé' })
        continue
      }

      const lead = await prisma.lead.create({
        data: {
          tenantId,
          code,
          name,
          company: String(get('company') || '').trim() || null,
          email: String(get('email') || '').trim() || null,
          phone: String(get('phone') || '').trim() || null,
          address: String(get('address') || '').trim() || null,
          city: String(get('city') || '').trim() || null,
          zipCode: String(get('zipCode') || '').trim() || null,
          sector: String(get('sector') || 'AUTRE').trim().toUpperCase() as any,
          source: String(get('source') || 'OTHER').trim().toUpperCase() as any,
          status: String(get('status') || 'NOUVEAU').trim().toUpperCase() as any,
          estimatedValue: get('estimatedValue') ? Number(get('estimatedValue')) : null,
          nextFollowUp: get('nextFollowUp') ? new Date(get('nextFollowUp')) : null,
          notes: String(get('notes') || '').trim() || null,
        },
      })
      log.push({ row: rowNum, code, name, id: lead.id })
    } catch (e: any) {
      errors.push({ row: rowNum, code, error: safeErrorMessage(e) })
    }
  }

  return { total: rows.length, imported: log.length, failed: errors.length, log, errors }
}