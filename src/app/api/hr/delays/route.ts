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
    const month = searchParams.get('month')
    const year = searchParams.get('year')

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    const where: any = { tenantId }
    if (employeeId) where.employeeId = employeeId
    if (month && year) {
      const date = new Date(`${year}-${String(month).padStart(2, '0')}-01`)
      where.date = { $gte: date, $lt: new Date(date.getFullYear(), date.getMonth() + 1, 1) }
    }

    const delays = await prisma.delay.findMany({
      where,
      include: { employee: true },
      orderBy: { date: 'desc' },
    })

    return NextResponse.json(delays)
  } catch (error) {
    console.error('Error fetching delays:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { tenantId: requestedTenantId, employeeId, date, heureArrivee, heureNormale, minutesRetard, justifie, motif } = body
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId || !employeeId || !date || !heureArrivee) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const badRef = await tenantRefsError(tenantId, { employee: employeeId })
    if (badRef) return badRef

    const delay = await prisma.delay.create({
      data: {
        tenantId,
        employeeId,
        date: new Date(date),
        heureArrivee,
        heureNormale: heureNormale || '08:00',
        minutesRetard: minutesRetard ?? 0,
        justifie: justifie ?? false,
        motif,
        statut: 'EN_ATTENTE',
      },
    })

    return NextResponse.json(delay)
  } catch (error) {
    console.error('Error creating delay:', error)
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
    const { id, statut, montantRetenu, sanction, justifie } = body

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    const delay = await prisma.delay.update({
      data: {
        ...(statut && { statut }),
        ...(montantRetenu !== undefined && { montantRetenu }),
        ...(sanction && { sanction }),
        ...(justifie !== undefined && { justifie }),
      },
      where: { id, tenantId: ctx.tenantId },
    })

    return NextResponse.json(delay)
  } catch (error) {
    console.error('Error updating delay:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}