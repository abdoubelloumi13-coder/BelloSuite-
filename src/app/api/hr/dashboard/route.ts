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

    const currentYear = new Date().getFullYear()
    const currentMonth = new Date().getMonth() + 1

    // Single aggregation query instead of 7 sequential calls
    const [
      employees,
      activeCount,
      pendingAbsences,
      pendingPayslips,
      latestPayslips,
      monthPayslips,
    ] = await Promise.all([
      // All employees (count + active)
      prisma.employee.aggregate({
        where: { tenantId },
        _count: true,
      }),
      prisma.employee.count({
        where: { tenantId, isActive: true },
      }),
      // Pending absences count
      prisma.absence.count({
        where: { tenantId, statut: 'EN_ATTENTE' },
      }),
      // Pending payslips for current month
      prisma.paySlip.count({
        where: {
          tenantId,
          annee: currentYear,
          mois: currentMonth,
          statut: 'PENDING',
        },
      }),
      // Latest 5 payslips (minimal select)
      prisma.paySlip.findMany({
        where: { tenantId },
        select: {
          id: true,
          reference: true,
          mois: true,
          annee: true,
          netAPayer: true,
          statut: true,
          createdAt: true,
          employee: {
            select: { firstName: true, lastName: true, employeeNumber: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      // Current month aggregated totals (no include, just sum)
      prisma.paySlip.aggregate({
        where: { tenantId, annee: currentYear, mois: currentMonth },
        _sum: { brutGlobal: true, netAPayer: true, irpp: true },
      }),
    ])

    return NextResponse.json({
      totalEmployees: employees._count,
      activeEmployees: activeCount,
      pendingAbsences,
      pendingPayslips,
      latestPayslips,
      masseSalariale: monthPayslips._sum.brutGlobal ?? 0,
      netAPayer: monthPayslips._sum.netAPayer ?? 0,
      totalIRPP: monthPayslips._sum.irpp ?? 0,
      currentMonth,
      currentYear,
    })
  } catch (error) {
    console.error('Error fetching HR dashboard:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
