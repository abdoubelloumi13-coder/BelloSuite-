import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getLeadById, updateLead, deleteLead, createLeadNote, createLeadNoteSchema, getLeadNotes, updateLeadSchema } from '@/services/leads'

// GET /api/crm/leads/[id]?tenantId=
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    const lead = await getLeadById(id, ctx.tenantId)
    const notes = await getLeadNotes(id, ctx.tenantId)
    return NextResponse.json({ ...lead, notes })
  } catch (err) {
    return handleApiError(err, 'GET lead')
  }
}

// PATCH /api/crm/leads/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    const data = parseBody(updateLeadSchema, body)
    if (data instanceof NextResponse) return data

    const lead = await updateLead(id, ctx.tenantId, data)
    return NextResponse.json(lead)
  } catch (err) {
    return handleApiError(err, 'PATCH lead')
  }
}

// DELETE /api/crm/leads/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    await deleteLead(id, ctx.tenantId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleApiError(err, 'DELETE lead')
  }
}