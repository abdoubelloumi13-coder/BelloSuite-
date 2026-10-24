import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logAudit, clientIp } from '@/lib/super-admin-audit'

export async function GET(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const modules = await prisma.module.findMany({ orderBy: { name: 'asc' } })
    return NextResponse.json(modules)
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { name, displayName, description, icon, monthlyPrice } = await req.json()
    if (!name || !displayName) return NextResponse.json({ error: 'name and displayName required' }, { status: 400 })

    const mod = await prisma.module.create({
      data: { name, displayName, description, icon: icon || '📦', monthlyPrice: monthlyPrice || 0, isActive: true }
    })
    return NextResponse.json(mod, { status: 201 })
  } catch (error: any) {
    if (error.code === 'P2002') return NextResponse.json({ error: 'Module name already exists' }, { status: 409 })
    return NextResponse.json({ error: 'Failed to create module' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const body = await req.json().catch(() => null)
    if (!body?.id) return NextResponse.json({ error: 'id requis' }, { status: 400 })
    // Champs modifiables uniquement (l'ancien code passait tout le corps à Prisma)
    const data: Record<string, unknown> = {}
    for (const k of ['displayName', 'description', 'icon'] as const) if (typeof body[k] === 'string') data[k] = body[k]
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive
    for (const k of ['monthlyPrice'] as const) {
      if (body[k] === undefined) continue
      const v = Number(body[k])
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: `${k} invalide` }, { status: 400 })
      data[k] = v
    }
    const mod = await prisma.module.update({ where: { id: body.id }, data })
    await logAudit(auth.id, 'MODULE_UPDATE', { target: 'module', targetId: body.id, details: data, ip: clientIp(req) })
    return NextResponse.json(mod)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update module' }, { status: 500 })
  }
}
