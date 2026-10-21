import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getInvoices, createInvoice, createInvoiceSchema, invoiceFiltersSchema } from '@/services/invoices'
import { InvoiceStatus } from '@prisma/client'
import { z } from 'zod'

// GET /api/commercial/invoices?tenantId=&status=&type=&id=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    // Parse & validate filters
    const rawStatus = searchParams.get('status')
    const filtersResult = invoiceFiltersSchema.safeParse({
      tenantId: ctx.tenantId,
      status: rawStatus && rawStatus !== 'TOUT' ? rawStatus as InvoiceStatus : undefined,
      type: searchParams.get('type') ?? undefined,
      id: searchParams.get('id') ?? undefined,
    })

    if (!filtersResult.success) {
      return NextResponse.json(
        { error: 'Paramètres invalides', details: filtersResult.error.issues },
        { status: 400 }
      )
    }

    const result = await getInvoices(filtersResult.data)
    return NextResponse.json(result)
  } catch (err) {
    return handleApiError(err, 'GET invoices')
  }
}

// POST /api/commercial/invoices
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    const data = parseBody(createInvoiceSchema, { ...body, tenantId: ctx.tenantId })
    if (data instanceof NextResponse) return data

    const invoice = await createInvoice(data, { userId: ctx.user?.id ?? null })
    return NextResponse.json(invoice, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST invoice')
  }
}