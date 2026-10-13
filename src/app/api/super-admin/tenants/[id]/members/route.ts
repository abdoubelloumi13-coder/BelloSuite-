import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/** Liste les membres (users) d'un tenant, avec leur rôle et statut. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    const tenant = await prisma.tenant.findUnique({ where: { id } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })
    const users = await prisma.user.findMany({
      where: { tenantId: id },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    })
    const safe = users.map(({ password: _, ...u }) => u)
    return NextResponse.json({ tenantId: id, tenantName: tenant.name, count: safe.length, users: safe })
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
