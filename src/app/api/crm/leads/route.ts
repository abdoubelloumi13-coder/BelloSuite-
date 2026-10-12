import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getLeads, createLead, createLeadSchema, updateLeadSchema, getPipelineStats } from '@/services/leads'

// GET /api/crm/leads?tenantId=&status=&sector=&city=&search=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    const status = searchParams.get('status') || undefined
    const sector = searchParams.get('sector') || undefined
    const city = searchParams.get('city') || undefined
    const search = searchParams.get('search') || undefined
    const statsOnly = searchParams.get('stats') === 'true'

    if (statsOnly) {
      const stats = await getPipelineStats(ctx.tenantId)
      return NextResponse.json(stats)
    }

    const leads = await getLeads(ctx.tenantId, { status, sector, city, search })
    return NextResponse.json(leads)
  } catch (err) {
    return handleApiError(err, 'GET leads')
  }
}

// POST /api/crm/leads
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    const data = parseBody(createLeadSchema, { ...body, tenantId: ctx.tenantId })
    if (data instanceof NextResponse) return data

    const lead = await createLead(data)
    return NextResponse.json(lead, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST lead')
  }
}