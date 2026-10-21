import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getEInvoiceStatus } from '@/lib/einvoice/service'

export const runtime = 'nodejs'

// GET /api/commercial/invoices/[id]/einvoice — état de la facture électronique (simulation)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json(await getEInvoiceStatus(ctx.tenantId, id))
  } catch (err) {
    return handleApiError(err, 'GET einvoice status')
  }
}
