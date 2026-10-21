import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { tenantRefsError } from '@/lib/tenant-scope'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:read')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId
    const employeeId = searchParams.get('employeeId')
    const year = searchParams.get('year')

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    const where: any = { tenantId }
    if (employeeId) where.employeeId = employeeId
    if (year) {
      const startDate = new Date(`${year}-01-01`)
      const endDate = new Date(`${year}-12-31`)
      where.dateDebut = { gte: startDate }
      where.dateFin = { lte: endDate }
    }

    const absences = await prisma.absence.findMany({
      where,
      include: { employee: true },
      orderBy: { dateDebut: 'desc' },
    })

    return NextResponse.json(absences)
  } catch (error) {
    console.error('Error fetching absences:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const {
      tenantId: requestedTenantId, employeeId, dateDebut, dateFin, type,
      joursCal, joursOuvres, justifie, pieceJointe, observations,
    } = body
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId || !employeeId || !dateDebut || !dateFin || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const badRef = await tenantRefsError(tenantId, { employee: employeeId })
    if (badRef) return badRef

    // Calculate working days difference
    const start = new Date(dateDebut)
    const end = new Date(dateFin)
    const joursOuvresCalc = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

    const absence = await prisma.absence.create({
      data: {
        tenantId,
        employeeId,
        dateDebut: new Date(dateDebut),
        dateFin: new Date(dateFin),
        type,
        joursCal: joursCal ?? joursOuvresCalc,
        joursOuvres: joursOuvres ?? joursOuvresCalc,
        justifie: justifie ?? false,
        pieceJointe,
        observations,
        statut: 'EN_ATTENTE',
      },
    })

    return NextResponse.json(absence)
  } catch (error: any) {
    console.error('Error creating absence:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const ctx = await requireTenant(request)
  if (ctx instanceof NextResponse) return ctx
  const accessDenied = requireAccess(ctx, 'hr:write')
  if (accessDenied) return accessDenied
  try {
    const body = await request.json()
    const { id, statut, montantRetenu, observations } = body

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    const absence = await prisma.absence.update({
      data: {
        ...(statut && { statut }),
        ...(montantRetenu !== undefined && { montantRetenu }),
        ...(observations && { observations }),
      },
      where: { id, tenantId: ctx.tenantId },
    })

    return NextResponse.json(absence)
  } catch (error) {
    console.error('Error updating absence:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}