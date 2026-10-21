import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getEInvoiceXml } from '@/lib/einvoice/service'

export const runtime = 'nodejs'

// GET /api/commercial/invoices/[id]/einvoice/xml            → TEIF non signé
// GET /api/commercial/invoices/[id]/einvoice/xml?signed=1   → TEIF signé (SigFrs)
// GET /api/commercial/invoices/[id]/einvoice/xml?validated=1 → TEIF validé (simulation TTN)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const sp = new URL(req.url).searchParams
    const ctx = await getApiContext(req, sp.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const on = (k: string) => ['1', 'true'].includes(sp.get(k) || '')
    const variant = on('validated') ? 'validated' : on('signed') ? 'signed' : 'unsigned'
    const { xml, filename } = await getEInvoiceXml(ctx.tenantId, id, variant)
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
        ...(variant !== 'unsigned' ? { 'X-EInvoice-Simulation': 'non-valable-fiscalement' } : {}),
      },
    })
  } catch (err) {
    return handleApiError(err, 'GET einvoice xml')
  }
}
