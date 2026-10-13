import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * Recherche globale cross-tenant : tenants, users, email, subdomain, matricule fiscal.
 * GET /api/super-admin/search?query=xyz
 */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const query = new URL(req.url).searchParams.get('query')?.trim() || ''
    if (query.length < 2) return NextResponse.json({ tenants: [], users: [] })
    const q = query.replace(/%/g, '\%').replace(/_/g, '\_')
    const like = { contains: q, mode: 'insensitive' as const }

    const tenants = await prisma.tenant.findMany({
      where: {
        OR: [
          { name: like },
          { subdomain: like },
          { matriculeFiscal: like },
          { email: like },
          { phone: like },
          { city: like },
        ],
      },
      include: { _count: { select: { users: true } } },
      take: 10,
    })

    const users = await prisma.user.findMany({
      where: {
        role: { not: 'SUPER_ADMIN' },
        OR: [
          { email: like },
          { firstName: like },
          { lastName: like },
        ],
      },
      select: {
        id: true, email: true, firstName: true, lastName: true, role: true, isActive: true,
        tenant: { select: { id: true, name: true, subdomain: true } },
      },
      take: 10,
    })

    return NextResponse.json({
      tenants: tenants.map(({ _count, ...t }) => ({ ...t, userCount: _count?.users ?? 0 })),
      users: users.map(u => u),
    })
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
