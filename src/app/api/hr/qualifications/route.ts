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
      return NextResponse.json({ error: 'Ce code de qualification existe déjà' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

// PATCH /api/hr/qualifications { id, designation?, coefficient?, salaryMin?, salaryMax?, isActive? }
export async function PATCH(request: Request) {
  try {
    const ctx = await requireTenant(request)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const body = await request.json().catch(() => null)
    if (!body?.id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    const existing = await prisma.qualification.findFirst({ where: { id: body.id, tenantId: ctx.tenantId }, select: { id: true } })
    if (!existing) return NextResponse.json({ error: 'Qualification introuvable' }, { status: 404 })
    const num = (v: unknown) => (v === undefined || v === '' || v === null ? undefined : Number(v))
    const data: Record<string, unknown> = {}
    if (typeof body.designation === 'string' && body.designation.trim()) data.designation = body.designation.trim()
    for (const k of ['coefficient', 'salaryMin', 'salaryMax'] as const) {
      const v = num(body[k])
      if (v !== undefined) {
        if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: `${k} invalide` }, { status: 400 })
        data[k] = v
      }
    }
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive
    const min = (data.salaryMin as number | undefined), max = (data.salaryMax as number | undefined)
    if (min !== undefined && max !== undefined && max > 0 && max < min) {
      return NextResponse.json({ error: 'Le salaire maximum doit être supérieur au minimum' }, { status: 400 })
    }
    const updated = await prisma.qualification.update({ where: { id: body.id }, data })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('Error updating qualification:', error)
    return NextResponse.json({ error: 'Mise à jour impossible' }, { status: 500 })
  }
}
