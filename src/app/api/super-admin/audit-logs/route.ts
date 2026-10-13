import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * Journal d'audit des actions super admin.
 * GET /api/super-admin/audit-logs?tenantId=&action=&page=&limit=
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const sp = new URL(req.url).searchParams
    const tenantId = sp.get('tenantId') || undefined
    const action = sp.get('action') || undefined
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(10, parseInt(sp.get('limit') || '50', 10)))

    const where: any = {}
    if (tenantId) where.tenantId = tenantId
    if (action) where.action = action

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          admin: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      }),
    ])

    // Résolution des noms des tenants concernés
    const tenantIds = [...new Set(logs.map(l => l.tenantId).filter(Boolean))] as string[]
    const tenants = await prisma.tenant.findMany({
      where: { id: { in: tenantIds } },
      select: { id: true, name: true, subdomain: true },
    })
    const tenantMap = new Map(tenants.map(t => [t.id, t]))

    return NextResponse.json({
      total,
      page,
      limit,
      logs: logs.map(l => ({
        ...l,
        tenant: l.tenantId ? tenantMap.get(l.tenantId) ?? null : null,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}