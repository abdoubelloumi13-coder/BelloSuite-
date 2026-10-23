import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { requireAccess } from '@/lib/rbac'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError, BusinessError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { tenantRefsError } from '@/lib/tenant-scope'
import { ABSENCE_TYPES, ABSENCE_STATUSES, countAbsenceDays } from '@/lib/hr-attendance'

const employeeSelect = { select: { id: true, firstName: true, lastName: true, employeeNumber: true } }

// GET /api/hr/absences?employeeId=&year=&statut=
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams
    const ctx = await getApiContext(req, sp.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'hr:read')
    if (denied) return denied

    const where: Prisma.AbsenceWhereInput = { tenantId: ctx.tenantId }
    const employeeId = sp.get('employeeId')
    const year = Number(sp.get('year'))
    const statut = sp.get('statut')
    if (employeeId) where.employeeId = employeeId
    if (statut && (ABSENCE_STATUSES as readonly string[]).includes(statut)) where.statut = statut as (typeof ABSENCE_STATUSES)[number]
    if (Number.isInteger(year) && year > 1900) {
      // toute absence qui chevauche l'année
      where.dateDebut = { lte: new Date(Date.UTC(year, 11, 31, 23, 59, 59)) }
      where.dateFin = { gte: new Date(Date.UTC(year, 0, 1)) }
    }
    const absences = await prisma.absence.findMany({ where, include: { employee: employeeSelect }, orderBy: { dateDebut: 'desc' }, take: 500 })
    return NextResponse.json(absences)
  } catch (err) {
    return handleApiError(err, 'GET absences')
  }
}

const createSchema = z.object({
  employeeId: z.string().min(1, 'employé requis'),
  dateDebut: z.string().min(1, 'date de début requise'),
  dateFin: z.string().min(1, 'date de fin requise'),
  type: z.enum(ABSENCE_TYPES),
  justifie: z.boolean().optional(),
  observations: z.string().trim().max(1000).nullable().optional(),
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

    const start = new Date(data.dateDebut)
    const end = new Date(data.dateFin)
    const days = countAbsenceDays(start, end)
    if (!days) throw new BusinessError('Dates invalides : la fin doit être égale ou postérieure au début', 400)

    const overlap = await prisma.absence.findFirst({
      where: { tenantId: ctx.tenantId, employeeId: data.employeeId, statut: { not: 'REJETE' }, dateDebut: { lte: end }, dateFin: { gte: start } },
      select: { id: true },
    })
    if (overlap) throw new BusinessError('Cet employé a déjà une absence sur cette période', 409)

    const absence = await prisma.absence.create({
      data: {
        tenantId: ctx.tenantId,
        employeeId: data.employeeId,
        dateDebut: start,
        dateFin: end,
        type: data.type,
        joursCal: days.joursCal,
        joursOuvres: days.joursOuvrables, // jours ouvrables (hors dimanches)
        justifie: data.justifie ?? false,
        observations: data.observations || null,
        statut: 'EN_ATTENTE',
      },
      include: { employee: employeeSelect },
    })
    return NextResponse.json(absence, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST absence')
  }
}

const patchSchema = z.object({
  id: z.string().min(1),
  statut: z.enum(ABSENCE_STATUSES).optional(),
  justifie: z.boolean().optional(),
  montantRetenu: z.coerce.number().min(0).optional(),
  observations: z.string().trim().max(1000).nullable().optional(),
})

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'hr:write')
    if (denied) return denied
    const data = parseBody(patchSchema, await req.json().catch(() => null))
    if (data instanceof NextResponse) return data
    const existing = await prisma.absence.findFirst({ where: { id: data.id, tenantId: ctx.tenantId }, select: { id: true } })
    if (!existing) throw new BusinessError('Absence introuvable', 404)
    const absence = await prisma.absence.update({
      where: { id: data.id },
      data: {
        ...(data.statut && { statut: data.statut }),
        ...(data.justifie !== undefined && { justifie: data.justifie }),
        ...(data.montantRetenu !== undefined && { montantRetenu: data.montantRetenu }),
        ...(data.observations !== undefined && { observations: data.observations || null }),
      },
      include: { employee: employeeSelect },
    })
    return NextResponse.json(absence)
  } catch (err) {
    return handleApiError(err, 'PATCH absence')
  }
}

// DELETE /api/hr/absences?id= — uniquement une demande encore en attente
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'hr:write')
    if (denied) return denied
    const id = new URL(req.url).searchParams.get('id')
    if (!id) throw new BusinessError('id requis', 400)
    const existing = await prisma.absence.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { statut: true } })
    if (!existing) throw new BusinessError('Absence introuvable', 404)
    if (existing.statut !== 'EN_ATTENTE') throw new BusinessError('Seule une absence en attente peut être supprimée', 409)
    await prisma.absence.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (err) {
    return handleApiError(err, 'DELETE absence')
  }
}
