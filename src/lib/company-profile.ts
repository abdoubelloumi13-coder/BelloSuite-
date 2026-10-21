/**
 * Profil légal de l'entreprise émettrice (tenant), utilisé par le TEIF (El Fatoora) et l'impression.
 * Colonnes Tenant existantes : name, matriculeFiscal, address, city, zipCode, phone, email.
 * Le RIB (pas de colonne) est rangé dans Tenant.settings.company.rib — aucune nouvelle colonne.
 */
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { blankToNull } from '@/lib/zod-helpers'
import { normalizeMatricule, isValidMatricule, normalizeRib, isValidRib } from '@/lib/matricule'

const text = (max = 200) => z.preprocess(blankToNull, z.string().trim().max(max).nullable().optional())

export const companyProfileSchema = z.object({
  name: z.string().trim().min(1, 'Raison sociale requise').max(200),
  matriculeFiscal: z.preprocess(
    v => (typeof v === 'string' && v.trim() ? normalizeMatricule(v) : null),
    z.string().nullable().optional().refine(v => !v || isValidMatricule(v), {
      message: 'Matricule fiscal invalide : 13 caractères attendus (7 chiffres + 3 lettres + 3 chiffres), ex. 1234567/A/A/M/000',
    }),
  ),
  address: text(300),
  city: text(100),
  zipCode: text(10),
  phone: text(30),
  email: z.preprocess(blankToNull, z.string().trim().email('E-mail invalide').nullable().optional()),
  rib: z.preprocess(
    v => (typeof v === 'string' && v.trim() ? normalizeRib(v) : null),
    z.string().nullable().optional().refine(v => !v || isValidRib(v), { message: 'RIB invalide : 20 chiffres attendus' }),
  ),
})

export type CompanyProfileInput = z.infer<typeof companyProfileSchema>

export interface CompanyProfile {
  name: string
  matriculeFiscal: string | null
  address: string | null
  city: string | null
  zipCode: string | null
  phone: string | null
  email: string | null
  rib: string | null
}

type SettingsObj = Record<string, unknown>
const asObj = (v: unknown): SettingsObj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as SettingsObj) : {})

export function companyRib(settings: unknown): string | null {
  const rib = asObj(asObj(settings).company).rib
  return typeof rib === 'string' && rib ? rib : null
}

export async function getCompanyProfile(tenantId: string): Promise<CompanyProfile> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true, matriculeFiscal: true, address: true, city: true, zipCode: true, phone: true, email: true, settings: true },
  })
  if (!t) throw new BusinessError('Entreprise introuvable', 404)
  return {
    name: t.name, matriculeFiscal: t.matriculeFiscal, address: t.address, city: t.city,
    zipCode: t.zipCode, phone: t.phone, email: t.email, rib: companyRib(t.settings),
  }
}

export async function saveCompanyProfile(tenantId: string, input: CompanyProfileInput): Promise<CompanyProfile> {
  const current = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  if (!current) throw new BusinessError('Entreprise introuvable', 404)
  const settings = asObj(current.settings)
  const company = { ...asObj(settings.company), rib: input.rib ?? null }
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      name: input.name,
      matriculeFiscal: input.matriculeFiscal ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      zipCode: input.zipCode ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      settings: { ...settings, company },
    },
  })
  return getCompanyProfile(tenantId)
}
