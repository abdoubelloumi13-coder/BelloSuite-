import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { closeSession } from '@/services/pos'

type Params = { params: Promise<{ id: string }> }

// GET /api/pos/sessions/[id] — session + tickets
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    const session = await prisma.pOSSession.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: { orders: { include: { items: true, payments: true }, orderBy: { createdAt: 'desc' } } },
    })
    if (!session) return NextResponse.json({ error: 'Session non trouvée' }, { status: 404 })
    return NextResponse.json({ data: session })
  } catch (err) {
    return handleApiError(err, 'GET pos session')
  }
}

// PATCH /api/pos/sessions/[id] — fermeture { countedCash?, notes? }
// Espèces attendues = fond de caisse + espèces encaissées − monnaie rendue (avant : fond + TOUT le CA,
// cartes et chèques compris). closingCash = montant compté ; l'écart figure dans le rapport Z renvoyé.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    const body = await req.json().catch(() => ({})) as { countedCash?: unknown; closingCash?: unknown; notes?: unknown }
    const raw = body.countedCash ?? body.closingCash
    const counted = raw === undefined || raw === null || raw === '' ? null : Number(raw)
    if (counted !== null && (!Number.isFinite(counted) || counted < 0)) {
      return NextResponse.json({ error: 'Montant compté invalide', details: [{ path: ['countedCash'], message: 'Montant positif attendu' }] }, { status: 400 })
    }
    const result = await closeSession(ctx.tenantId, id, { countedCash: counted, notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null })
    return NextResponse.json({ data: result.session, report: result.report })
  } catch (err) {
    return handleApiError(err, 'PATCH pos session (fermeture)')
  }
}
