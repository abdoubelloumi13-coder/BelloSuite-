import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'

// GET /api/tenant/users — utilisateurs de l'entreprise (lecture seule, jamais le mot de passe)
export async function GET(req: NextRequest) {
  try {
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const users = await prisma.user.findMany({
      where: { tenantId: ctx.tenantId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true },
      orderBy: [{ isActive: 'desc' }, { email: 'asc' }],
    })
    return NextResponse.json(users)
  } catch (err) {
    return handleApiError(err, 'GET tenant users')
  }
}
