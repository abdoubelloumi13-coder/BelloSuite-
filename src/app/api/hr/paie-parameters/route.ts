import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { sanitizePaieParamsInput } from '@/lib/payroll'
import { payrollErrorMessage } from '@/lib/payroll-payslip'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'Société (tenantId) requise' }, { status: 400 })
    }

    // upsert : deux premiers chargements simultanés ne peuvent plus créer deux lignes (unicité tenantId)
    const params = await prisma.paieParameters.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    })

    return NextResponse.json(params)
  } catch (error) {
    console.error('Error fetching paie parameters:', error)
    return NextResponse.json({ error: payrollErrorMessage(error, 'Paramètres de paie indisponibles') }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    const { tenantId: requestedTenantId, ...updates } = body
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'Société (tenantId) requise' }, { status: 400 })
    }

    const current = await prisma.paieParameters.findUnique({ where: { tenantId } })
    const clean = sanitizePaieParamsInput(updates ?? {}, current as unknown as Record<string, unknown> | null)
    if (clean.error !== undefined) return NextResponse.json({ error: clean.error }, { status: 400 })

    const params = await prisma.paieParameters.upsert({
      where: { tenantId },
      update: clean.data as any, // TODO prisma generate (nouveaux champs 2026)
      create: { tenantId, ...clean.data } as any,
    })

    return NextResponse.json(params)
  } catch (error) {
    console.error('Error updating paie parameters:', error)
    return NextResponse.json({ error: payrollErrorMessage(error, 'Enregistrement des paramètres de paie impossible') }, { status: 500 })
  }
}