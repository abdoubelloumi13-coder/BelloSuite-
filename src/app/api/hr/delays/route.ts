import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { requireAccess } from '@/lib/rbac'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError, BusinessError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { tenantRefsError } from '@/lib/tenant-scope'
import { ABSENCE_STATUSES, SANCTIONS, isHHMM, lateMinutes } from '@/lib/hr-attendance'

const employeeSelect = { select: { id: true, firstName: true, lastName: true, employeeNumber: true } }

// GET /api/hr/delays?employeeId=&month=&year=
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams
    const ctx = await getApiContext(req, sp.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'hr:read')
    if (denied) return denied

    const where: Prisma.DelayWhereInput = { tenantId: ctx.tenantId }
    const employeeId = sp.get('employeeId')
    const month = Number(sp.get('month'))
    const year = Number(sp.get('year'))
    if (employeeId) where.employeeId = employeeId
    if (Number.isInteger(year) && year > 1900) {
      // (ancien code : opérateurs « $gte » façon MongoDB → erreur Prisma dès qu'on filtrait par mois)
      where.date = month >= 1 && month <= 12
        ? { gte: new Date(Date.UTC(year, month - 1, 1)), lt: new Date(Date.UTC(year, month, 1)) }
        : { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) }
    }
    const delays = await prisma.delay.findMany({ where, include: { employee: employeeSelect }, orderBy: { date: 'desc' }, take: 500 })
    return NextResponse.json(delays)
  } catch (err) {
    return handleApiError(err, 'GET delays')
  }
}

const createSchema = z.object({
  employeeId: z.string().min(1, 'employé requis'),
  date: z.string().min(1, 'date requise'),
  heureArrivee: z.string().refine(isHHMM, 'heure d\u2019arrivée au format HH:MM'),
  heureNormale: z.string().refine(isHHMM, 'heure normale au format HH:MM').optional(),
  justifie: z.boolean().optional(),
  motif: z.string().trim().max(500).nullable().optional(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'hr:write')
    if (denied) return denied
    const data = parseBody(createSchema, body)
    if (data instanceof NextResponse) return data
    const badRef = await tenantRefsError(ctx.tenantId, { employee: data.employeeId })
    if (badRef) return badRef
    const date = new Date(data.date)
    if (Number.isNaN(date.getTime())) throw new BusinessError('Date invalide', 400)
    const heureNormale = data.heureNormale || '08:00'
    const minutes = lateMinutes(data.heureArrivee, heureNormale) ?? 0
    if (minutes === 0) throw new BusinessError('Aucun retard : l\u2019heure d\u2019arrivée ne dépasse pas l\u2019heure normale', 400)

    const delay = await prisma.delay.create({
      data: {
        tenantId: ctx.tenantId,
        employeeId: data.employeeId,
        date,
        heureArrivee: data.heureArrivee,
        heureNormale,
        minutesRetard: minutes,
        justifie: data.justifie ?? false,
        sanction: 'RIEN',
        motif: data.motif || null,
        statut: 'EN_ATTENTE',
      },
      include: { employee: employeeSelect },
    })
    return NextResponse.json(delay, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST delay')
  }
}

const patchSchema = z.object({
  id: z.string().min(1),
  statut: z.enum(ABSENCE_STATUSES).optional(),
  sanction: z.enum(SANCTIONS).optional(),
  justifie: z.boolean().optional(),
  montantRetenu: z.coerce.number().min(0).optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'hr:write')
    if (denied) return denied
    const data = parseBody(patchSchema, await req.json().catch(() => null))
    if (data instanceof NextResponse) return data
    const existing = await prisma.delay.findFirst({ where: { id: data.id, tenantId: ctx.tenantId }, select: { id: true } })
    if (!existing) throw new BusinessError('Retard introuvable', 404)
    const delay = await prisma.delay.update({
      where: { id: data.id },
      data: {
        ...(data.statut && { statut: data.statut }),
        ...(data.sanction && { sanction: data.sanction }),
        ...(data.justifie !== undefined && { justifie: data.justifie }),
        ...(data.montantRetenu !== undefined && { montantRetenu: data.montantRetenu }),
      },
      include: { employee: employeeSelect },
    })
    return NextResponse.json(delay)
  } catch (err) {
    return handleApiError(err, 'PATCH delay')
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'hr:write')
    if (denied) return denied
    const id = new URL(req.url).searchParams.get('id')
    if (!id) throw new BusinessError('id requis', 400)
    const existing = await prisma.delay.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { statut: true } })
    if (!existing) throw new BusinessError('Retard introuvable', 404)
    if (existing.statut !== 'EN_ATTENTE') throw new BusinessError('Seul un retard en attente peut être supprimé', 409)
    await prisma.delay.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    return handleApiError(err, 'DELETE delay')
  }
}
