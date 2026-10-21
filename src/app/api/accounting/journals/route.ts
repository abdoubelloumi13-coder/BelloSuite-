import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { z } from 'zod'
import { JournalType } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getJournals, createJournalEntry, journalEntrySchema } from '@/services/accounting'

const journalSchema = z.object({
  code: z.string().trim().min(1, 'code requis').max(10).transform(v => v.toUpperCase()),
  name: z.string().trim().min(1, 'nom requis'),
  type: z.nativeEnum(JournalType).default(JournalType.GENERAL),
})

// GET /api/accounting/journals
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx

    const journals = await getJournals(ctx.tenantId)
    return NextResponse.json(journals)
  } catch (err) {
    return handleApiError(err, 'GET journals')
  }
}

// POST /api/accounting/journals/entries
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx

    // La page « Journaux » envoie { code, name, type } : création d'un journal (et non d'une écriture)
    if (!Array.isArray(body?.lines)) {
      const j = parseBody(journalSchema, body)
      if (j instanceof NextResponse) return j
      const exists = await prisma.accountingJournal.findFirst({ where: { tenantId: ctx.tenantId, code: j.code } })
      if (exists) return NextResponse.json({ error: `Le code journal ${j.code} existe déjà` }, { status: 409 })
      const journal = await prisma.accountingJournal.create({ data: { tenantId: ctx.tenantId, ...j } })
      return NextResponse.json(journal, { status: 201 })
    }

    const data = parseBody(journalEntrySchema, { ...body, tenantId: ctx.tenantId })
    if (data instanceof NextResponse) return data

    const entry = await createJournalEntry(data)
    return NextResponse.json(entry, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST journal entry')
  }
}
