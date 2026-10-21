import { requireAccess } from '@/lib/rbac'
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { listJournalEntries, createManualEntry, manualEntrySchema } from '@/services/journal-entries'

// GET /api/accounting/entries?journalId=&periodId=&startDate=&endDate=
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams
    const ctx = await getApiContext(req, sp.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const entries = await listJournalEntries(ctx.tenantId, {
      journalId: sp.get('journalId') || undefined,
      periodId: sp.get('periodId') || undefined,
      startDate: sp.get('startDate') || undefined,
      endDate: sp.get('endDate') || undefined,
    })
    return NextResponse.json(entries)
  } catch (err) {
    return handleApiError(err, 'GET journal entries')
  }
}

// POST /api/accounting/entries — écriture manuelle équilibrée (débit = crédit)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Corps JSON invalide' }, { status: 400 })
    const ctx = await getApiContext(req, body.tenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'accounting:write')
    if (accessDenied) return accessDenied
    const data = parseBody(manualEntrySchema, body)
    if (data instanceof NextResponse) return data
    const entry = await createManualEntry(ctx.tenantId, data)
    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST journal entry')
  }
}
