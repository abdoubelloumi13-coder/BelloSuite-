import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { submitInvoice } from '@/lib/einvoice/service'

export const runtime = 'nodejs'

// POST /api/commercial/invoices/[id]/einvoice/submit — dépôt au simulateur TTN (aucun appel réseau)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const ctx = await getApiContext(req, body?.tenantId ?? new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json(await submitInvoice(ctx.tenantId, id))
  } catch (err) {
    return handleApiError(err, 'POST einvoice submit')
  }
}
