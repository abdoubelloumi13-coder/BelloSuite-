import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { generateInvoiceEntry } from '@/services/accounting'

// POST /api/commercial/accounting/generate-entries { invoiceId } — écriture (brouillon) selon le plan tunisien.
// Factures et avoirs uniquement ; idempotent : une écriture existante est renvoyée (alreadyExists: true).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx
    const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : ''
    if (!invoiceId) return NextResponse.json({ error: 'invoiceId requis', field: 'invoiceId' }, { status: 400 })
    const entry = await generateInvoiceEntry(invoiceId, ctx.tenantId, { posted: false })
    return NextResponse.json(entry)
  } catch (err) {
    return handleApiError(err, 'POST generate-entries')
  }
}
