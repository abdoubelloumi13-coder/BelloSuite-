import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:read')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    const qualifications = await prisma.qualification.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: 'asc' },
    })

    return NextResponse.json(qualifications)
  } catch (error) {
    console.error('Error fetching qualifications:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { tenantId: requestedTenantId, code, designation, coefficient, salaryMin, salaryMax } = body
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId || !code || !designation) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const qualification = await prisma.qualification.create({
      data: {
        tenantId,
        code,
        designation,
        coefficient: coefficient ? Number(coefficient) : 1,
        salaryMin: salaryMin ? Number(salaryMin) : 0,
        salaryMax: salaryMax ? Number(salaryMax) : 0,
      },
    })

    return NextResponse.json(qualification)
  } catch (error: any) {
    console.error('Error creating qualification:', error)
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Qualification code already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}