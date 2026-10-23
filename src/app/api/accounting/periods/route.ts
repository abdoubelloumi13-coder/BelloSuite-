import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from "@/lib/db";


export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await requireTenant(req, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 })
    }

    const periods = await prisma.accountingPeriod.findMany({
      where: { tenantId },
      orderBy: { startDate: 'desc' }
    })

    return NextResponse.json(periods)
  } catch (error) {
    console.error('Error fetching periods:', error)
    return NextResponse.json({ error: 'Failed to fetch periods' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const { tenantId: requestedTenantId, name, startDate, endDate } = await req.json()
    const ctx = await requireTenant(req, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'accounting:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId || !name || !startDate || !endDate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return NextResponse.json({ error: 'Dates d\u2019exercice invalides : la fin doit suivre le début' }, { status: 400 })
    }
    const overlap = await prisma.accountingPeriod.findFirst({
      where: { tenantId, startDate: { lte: end }, endDate: { gte: start } },
      select: { name: true },
    })
    if (overlap) {
      return NextResponse.json({ error: `Cet exercice chevauche l\u2019exercice ${overlap.name}` }, { status: 409 })
    }

    const newPeriod = await prisma.accountingPeriod.create({
      data: {
        name,
        startDate: start,
        endDate: end,
        tenant: {
          connect: { id: tenantId }
        }
      }
    })

    return NextResponse.json(newPeriod, { status: 201 })
  } catch (error) {
    console.error('Error creating period:', error)
    return NextResponse.json({ error: 'Création de l\u2019exercice impossible (nom déjà utilisé ?)' }, { status: 500 })
  }
}
