/**
 * POST /api/firm/clients — le cabinet ouvre lui-même le dossier d'un client (nouvelle entreprise),
 * avec un accès ACTIF d'origine CREATED. L'entreprise pourra ensuite inviter ses propres utilisateurs
 * et révoquer l'accès du cabinet depuis ses paramètres.
 */
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/api-auth'
import { parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getFirmMembership } from '@/lib/firm-access'
import { MAX_FIRM_CLIENTS } from '@/lib/firm-dashboard'
import { slugifySubdomain } from '@/lib/onboarding'
import { enforceRateLimits } from '@/lib/rate-limit-persistent'

export const runtime = 'nodejs'

const DEFAULT_MODULES = ['Stock', 'Commercial', 'Accounting']

const schema = z.object({
  companyName: z.string().trim().min(1).max(120),
  matriculeFiscal: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().nullable(),
})

export async function POST(req: Request) {
  try {
    const session = await requireSession(req)
    if (session instanceof NextResponse) return session
    const m = await getFirmMembership(session.id)
    if (!m) return NextResponse.json({ error: 'Aucun cabinet' }, { status: 403 })
    const limited = await enforceRateLimits([{ key: `firm-client-create:firm:${m.firmId}`, max: 30, windowSeconds: 3600 }])
    if (limited) return limited
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(schema, body)
    if (data instanceof NextResponse) return data
    if ((await prisma.firmClientAccess.count({ where: { firmId: m.firmId, status: 'ACTIVE' } })) >= MAX_FIRM_CLIENTS) {
      return NextResponse.json({ error: `Limite de ${MAX_FIRM_CLIENTS} dossiers atteinte` }, { status: 409 })
    }
    const base = slugifySubdomain(data.companyName) || 'client'
    const subdomain = `${base.slice(0, 30)}-${randomBytes(3).toString('hex')}`

    const tenant = await prisma.$transaction(async (tx) => {
      const created = await tx.tenant.create({
        data: {
          name: data.companyName, subdomain, matriculeFiscal: data.matriculeFiscal || null,
          address: data.address || null, city: data.city || null, phone: data.phone || null, email: data.email || null, isActive: true,
        },
        select: { id: true, name: true, matriculeFiscal: true },
      })
      const modules = await tx.module.findMany({ where: { name: { in: DEFAULT_MODULES }, isActive: true } })
      if (modules.length) await tx.tenantModule.createMany({ data: modules.map((mo) => ({ tenantId: created.id, moduleId: mo.id, isEnabled: true })) })
      await tx.firmClientAccess.create({ data: { firmId: m.firmId, tenantId: created.id, status: 'ACTIVE', origin: 'CREATED', grantedById: session.id } })
      return created
    })
    return NextResponse.json({ client: tenant }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST firm/clients')
  }
}
