import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { dropEmptyStrings, parseBodyFields } from '@/lib/zod-errors'
import { handleApiError } from '@/lib/errors'
import { paymentSchema, postPaymentToAccounting } from '@/services/accounting'

// POST /api/commercial/invoices/[id]/pay { method: 'CASH'|'BANK', amount?, rsAmount?, date? }
// Règlement total (défaut) ou partiel, avec retenue à la source subie éventuelle.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    const data = parseBodyFields(paymentSchema, dropEmptyStrings(body ?? {}))
    if (data instanceof NextResponse) return data

    const entry = await postPaymentToAccounting(id, ctx.tenantId, data)
    return NextResponse.json(entry)
  } catch (err) {
    return handleApiError(err, 'POST invoice payment')
  }
}
