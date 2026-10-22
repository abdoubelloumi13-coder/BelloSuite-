import { safeErrorResponse } from '@/lib/security/safe-error'
import { projectInTenant, columnInTenant, taskInTenant, notFound } from '@/lib/tenant-scope'
import { requireTenant } from '@/lib/api-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// POST /api/projects/[id]/columns — add column
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = await req.json()
    const { projectId, name, color, isDone } = body
    if (!projectId || !name) return NextResponse.json({ error: 'projectId and name required' }, { status: 400 })
    if (!(await projectInTenant(projectId, ctx.tenantId))) return notFound()
    const maxPos = await prisma.projectColumn.aggregate({ where: { projectId }, _max: { position: true } })
    const col = await prisma.projectColumn.create({
      data: { projectId, name, color: color || '#6366f1', isDone: isDone || false, position: (maxPos._max.position ?? -1) + 1 },
    })
    return NextResponse.json(col)
  } catch (e: any) {
    return safeErrorResponse(e, 'projects', 'Opération impossible')
  }
}

// PATCH /api/projects/[id]/columns?id=xxx — update column
export async function PATCH(req: NextRequest) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const { searchParams } = new URL(req.url)
    const columnId = searchParams.get('id')
    if (!columnId) return NextResponse.json({ error: 'columnId required' }, { status: 400 })
    if (!(await columnInTenant(columnId, ctx.tenantId))) return notFound()
    const body = await req.json()
    const updated = await prisma.projectColumn.update({
      where: { id: columnId },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.color !== undefined && { color: body.color }),
        ...(body.isDone !== undefined && { isDone: body.isDone }),
      },
    })
    return NextResponse.json(updated)
  } catch (e: any) {
    return safeErrorResponse(e, 'projects', 'Opération impossible')
  }
}

// DELETE /api/projects/[id]/columns?id=xxx
export async function DELETE(req: NextRequest) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const { searchParams } = new URL(req.url)
    const columnId = searchParams.get('id')
    if (!columnId) return NextResponse.json({ error: 'columnId required' }, { status: 400 })
    if (!(await columnInTenant(columnId, ctx.tenantId))) return notFound()
    await prisma.projectColumn.delete({ where: { id: columnId } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return safeErrorResponse(e, 'projects', 'Opération impossible')
  }
}
