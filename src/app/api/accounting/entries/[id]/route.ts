/** DELETE /api/accounting/entries/:id — supprime un brouillon (une écriture validée est définitive). */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { requireAccess } from '@/lib/rbac'
import { deleteDraftEntry } from '@/services/fiscal-close'

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const denied = requireAccess(ctx, 'accounting:write')
    if (denied) return denied
    const { id } = await params
    return NextResponse.json(await deleteDraftEntry(ctx.tenantId, id))
  } catch (err) {
    return handleApiError(err, 'delete journal entry')
  }
}
