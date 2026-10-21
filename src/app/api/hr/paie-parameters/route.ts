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

    let params = await prisma.paieParameters.findUnique({
      where: { tenantId },
    })

    if (!params) {
      params = await prisma.paieParameters.create({
        data: { tenantId },
      })
    }

    return NextResponse.json(params)
  } catch (error) {
    console.error('Error fetching paie parameters:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { tenantId: requestedTenantId, ...updates } = body
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    const params = await prisma.paieParameters.upsert({
      where: { tenantId },
      update: updates,
      create: { tenantId, ...updates },
    })

    return NextResponse.json(params)
  } catch (error) {
    console.error('Error updating paie parameters:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}