import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { dropEmptyStrings, parseBodyFields } from '@/lib/zod-errors'
import { handleApiError } from '@/lib/errors'
import { getWithholdingTaxes, createWithholdingTax, createWithholdingTaxSchema } from '@/services/withholding-tax'
import { TEJStatus } from '@prisma/client'

// GET /api/commercial/retenue-source?tenantId=&periodYear=&periodMonth=&tejStatus=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    const periodYear = searchParams.get('periodYear') ? Number(searchParams.get('periodYear')) : undefined
    const periodMonth = searchParams.get('periodMonth') ? Number(searchParams.get('periodMonth')) : undefined
    const tejStatus = searchParams.get('tejStatus') as TEJStatus | undefined
    const dir = searchParams.get('direction')
    const direction = dir === 'SUFFERED' || dir === 'DECLARED' ? dir : undefined

    const records = await getWithholdingTaxes(ctx.tenantId, { periodYear, periodMonth, tejStatus, direction })
    return NextResponse.json(records)
  } catch (err) {
    return handleApiError(err, 'GET withholding taxes')
  }
}

// POST /api/commercial/retenue-source
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))

    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    // Champs laissés vides (mode de paiement « — », date…) = non renseignés ; erreurs renvoyées champ par champ
    const data = parseBodyFields(createWithholdingTaxSchema, { ...dropEmptyStrings(body ?? {}, ['beneficiaryName']), tenantId: ctx.tenantId })
    if (data instanceof NextResponse) return data

    const record = await createWithholdingTax(data)
    return NextResponse.json(record, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST withholding tax')
  }
}
