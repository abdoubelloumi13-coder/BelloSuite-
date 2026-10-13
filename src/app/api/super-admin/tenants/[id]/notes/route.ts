import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { z } from 'zod'

const noteSchema = z.object({ content: z.string().min(1, 'contenu requis').max(5000) })

/** Notes internes sur un tenant (support, incidents, relances) — GET + POST. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    const notes = await prisma.tenantNote.findMany({
      where: { tenantId: id },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })
    return NextResponse.json(notes)
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    const body = noteSchema.parse(await req.json())
    const tenant = await prisma.tenant.findUnique({ where: { id }, select: { id: true } })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })
    const note = await prisma.tenantNote.create({
      data: { tenantId: id, authorId: auth.id, content: body.content },
      include: { author: { select: { id: true, firstName: true, lastName: true, email: true } } },
    })
    return NextResponse.json(note, { status: 201 })
  } catch (e: any) {
    if (e.name === 'ZodError') return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
