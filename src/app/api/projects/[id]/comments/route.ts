import { safeErrorResponse } from '@/lib/security/safe-error'
import { projectInTenant, columnInTenant, taskInTenant, notFound } from '@/lib/tenant-scope'
import { requireTenant } from '@/lib/api-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/projects/[id]/comments?taskId=xxx
export async function GET(req: NextRequest) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const { searchParams } = new URL(req.url)
    const taskId = searchParams.get('taskId')
    if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })
    if (!(await taskInTenant(taskId, ctx.tenantId))) return notFound()
    const comments = await prisma.projectComment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(comments)
  } catch (e: any) {
    return safeErrorResponse(e, 'projects', 'Opération impossible')
  }
}

// POST /api/projects/[id]/comments — add comment
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const body = await req.json()
    const { taskId, content } = body
    // Auteur = utilisateur de la session (jamais celui envoyé par le client)
    const authorId = ctx.user.id
    const authorName = ctx.user.firstName || ctx.user.email
    if (!taskId || !content) {
      return NextResponse.json({ error: 'All fields required' }, { status: 400 })
    }
    if (!(await taskInTenant(taskId, ctx.tenantId))) return notFound()
    const comment = await prisma.projectComment.create({
      data: { taskId, authorId, authorName, content },
    })
    return NextResponse.json(comment)
  } catch (e: any) {
    return safeErrorResponse(e, 'projects', 'Opération impossible')
  }
}
