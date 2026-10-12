import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { createLeadNote, getLeadNotes, createLeadNoteSchema } from '@/services/leads'

// GET /api/crm/leads/[id]/notes?tenantId=
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    const notes = await getLeadNotes(id, ctx.tenantId)
    return NextResponse.json(notes)
  } catch (err) {
    return handleApiError(err, 'GET lead notes')
  }
}

// POST /api/crm/leads/[id]/notes
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    const data = parseBody(createLeadNoteSchema, { ...body, tenantId: ctx.tenantId, leadId: id })
    if (data instanceof NextResponse) return data

    const note = await createLeadNote(data)
    return NextResponse.json(note, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST lead note')
  }
}