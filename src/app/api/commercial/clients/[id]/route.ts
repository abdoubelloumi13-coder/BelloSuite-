import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getClientById, updateClient, updateClientSchema, deleteClient } from '@/services/clients'

// GET /api/commercial/clients/[id]
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    return NextResponse.json(await getClientById(id, ctx.tenantId))
  } catch (err) {
    return handleApiError(err, 'GET client')
  }
}

// PUT /api/commercial/clients/[id] — mêmes règles de validation que la création ('' → non renseigné)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    const data = parseBody(updateClientSchema, body)
    if (data instanceof NextResponse) return data

    const { id } = await params
    return NextResponse.json(await updateClient(id, ctx.tenantId, data))
  } catch (err) {
    return handleApiError(err, 'PUT client')
  }
}

// DELETE /api/commercial/clients/[id] — refus explicite (409) si des factures y sont liées
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    await deleteClient(id, ctx.tenantId)
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleApiError(err, 'DELETE client')
  }
}
