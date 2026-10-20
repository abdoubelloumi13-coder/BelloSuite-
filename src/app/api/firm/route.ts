/**
 * Espace cabinet comptable.
 *  GET  /api/firm → { firm, role, clients: ClientSnapshot[] } (firm = null si l'utilisateur n'est membre d'aucun cabinet)
 *  POST /api/firm → crée le cabinet de l'utilisateur connecté (il en devient OWNER)
 *
 * SÉCURITÉ : identité depuis la session signée. Les dossiers visibles sont ceux dont l'accès est ACTIF.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/api-auth'
import { parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getFirmMembership } from '@/lib/firm-access'
import { clientSnapshots } from '@/lib/firm-dashboard'
import { enforceRateLimits } from '@/lib/rate-limit-persistent'

export const runtime = 'nodejs'

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  matriculeFiscal: z.string().trim().max(40).optional().nullable(),
  email: z.union([z.string().trim().email(), z.literal('')]).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
})

export async function GET(req: Request) {
  try {
    const session = await requireSession(req)
    if (session instanceof NextResponse) return session
    const m = await getFirmMembership(session.id)
    if (!m) return NextResponse.json({ firm: null, clients: [] })
    const clients = await clientSnapshots(m.firmId)
    return NextResponse.json({ firm: m.firm, role: m.role, activeTenantId: session.firmId ? session.tenantId : null, clients })
  } catch (err) {
    return handleApiError(err, 'GET firm')
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession(req)
    if (session instanceof NextResponse) return session
    if (session.role === 'SUPER_ADMIN') return NextResponse.json({ error: 'Non disponible pour le Super Admin' }, { status: 403 })
    if (session.firmId) return NextResponse.json({ error: 'Revenez à votre compte avant de créer un cabinet' }, { status: 409 })
    const limited = await enforceRateLimits([{ key: `firm-create:user:${session.id}`, max: 5, windowSeconds: 3600 }])
    if (limited) return limited
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const data = parseBody(createSchema, body)
    if (data instanceof NextResponse) return data
    if (await getFirmMembership(session.id)) return NextResponse.json({ error: 'Vous faites déjà partie d’un cabinet' }, { status: 409 })
    const firm = await prisma.accountingFirm.create({
      data: {
        name: data.name, matriculeFiscal: data.matriculeFiscal || null, email: data.email || null, phone: data.phone || null,
        members: { create: { userId: session.id, role: 'OWNER' } },
      },
      select: { id: true, name: true, matriculeFiscal: true },
    })
    return NextResponse.json({ firm, role: 'OWNER' }, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST firm')
  }
}
