import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { updateEmployeeSchema, toEmployeeUpdateData } from '@/services/hr'
import { BusinessError } from '@/lib/errors'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:read')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    const employee = await prisma.employee.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: {
        qualification: true,
        absences: { orderBy: { dateDebut: 'desc' }, take: 5 },
        delays: { orderBy: { date: 'desc' }, take: 5 },
        mutations: { orderBy: { dateEffet: 'desc' }, take: 3 },
        paySlips: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    })

    if (!employee) {
      return NextResponse.json({ error: 'Employé introuvable' }, { status: 404 })
    }

    return NextResponse.json(employee)
  } catch (error) {
    console.error('Error fetching employee:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const { tenantId: requestedTenantId, ...data } = body
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    // Liste blanche des champs de la fiche (situation familiale, enfants à charge, salaire…) — erreurs en français
    const parsed = updateEmployeeSchema.safeParse(data)
    if (!parsed.success) {
      const msg = parsed.error.issues.map(i => i.message).join(' ; ')
      return NextResponse.json({ error: `Fiche employé invalide : ${msg}` }, { status: 400 })
    }
    let updateData: Record<string, unknown>
    try {
      updateData = toEmployeeUpdateData(parsed.data)
    } catch (e) {
      if (e instanceof BusinessError) return NextResponse.json({ error: e.message }, { status: e.statusCode })
      throw e
    }

    const employee = await prisma.employee.updateMany({
      where: { id, tenantId },
      data: updateData,
    })

    if (employee.count === 0) {
      return NextResponse.json({ error: 'Employé introuvable' }, { status: 404 })
    }

    const updated = await prisma.employee.findFirst({ where: { id, tenantId } })
    return NextResponse.json(updated)
  } catch (error: any) {
    console.error('Error updating employee:', error)
    if (error?.code === 'P2002') return NextResponse.json({ error: 'Ce matricule est déjà utilisé par un autre employé' }, { status: 409 })
    return NextResponse.json({ error: "Modification de l'employé impossible (erreur serveur)" }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    const employee = await prisma.employee.updateMany({
      where: { id, tenantId },
      data: { isActive: false },
    })

    if (employee.count === 0) {
      return NextResponse.json({ error: 'Employé introuvable' }, { status: 404 })
    }

    return NextResponse.json({ message: 'Employee deactivated' })
  } catch (error) {
    console.error('Error deleting employee:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
