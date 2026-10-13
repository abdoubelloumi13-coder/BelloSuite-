import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/** Suppression d'une note interne (son auteur ou un autre super admin). */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { noteId } = await params
    const note = await prisma.tenantNote.findFirst({ where: { id: noteId } })
    if (!note) return NextResponse.json({ error: 'Note introuvable' }, { status: 404 })
    if (note.authorId !== auth.id) {
      return NextResponse.json({ error: 'Seul son auteur peut supprimer cette note' }, { status: 403 })
    }
    await prisma.tenantNote.delete({ where: { id: noteId } })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
