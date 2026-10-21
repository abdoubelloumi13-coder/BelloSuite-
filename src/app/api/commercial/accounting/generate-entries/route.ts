import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { BusinessError, handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { JOURNALIZATION_RULES, buildAutoEntryLines, buildEntryDescription } from '@/lib/accounting-auto'
import { ensureAccount, ensureJournal, ensurePeriodFor } from '@/services/accounting'

// POST /api/commercial/accounting/generate-entries { invoiceId } — écriture (brouillon) selon le plan tunisien
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId
    const invoiceId = typeof body?.invoiceId === 'string' ? body.invoiceId : ''
    if (!invoiceId) return NextResponse.json({ error: 'invoiceId requis' }, { status: 400 })

    const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, tenantId }, include: { client: true } })
    if (!invoice) return NextResponse.json({ error: 'Facture introuvable' }, { status: 404 })

    const rule = JOURNALIZATION_RULES[invoice.type]
    if (!rule || rule.lines.length === 0) {
      return NextResponse.json({ message: 'Aucune écriture comptable pour ce type de document (ex. devis)' })
    }
    const built = buildAutoEntryLines(invoice, rule)
    if (!built.lines.length) return NextResponse.json({ message: 'Montants nuls : aucune écriture générée' })
    if (!built.balanced) throw new BusinessError('Montants de la facture incohérents (HT + FODEC + TVA + timbre ≠ TTC)', 400)

    const entry = await prisma.$transaction(async (tx) => {
      const journal = await ensureJournal(tx, tenantId, 'VT')
      const period = await ensurePeriodFor(tx, tenantId, invoice.date)
      const lines = []
      for (const l of built.lines) {
        const acc = await ensureAccount(tx, tenantId, l.account)
        lines.push({ accountId: acc.id, debit: l.debit, credit: l.credit, description: `${l.label}${invoice.client?.name ? ` — ${invoice.client.name}` : ''}` })
      }
      return tx.journalEntry.create({
        data: {
          tenantId,
          journalId: journal.id,
          periodId: period.id,
          entryNumber: `AUTO-${invoice.number}-${Date.now().toString(36).toUpperCase()}`,
          date: invoice.date,
          description: buildEntryDescription(invoice),
          isPosted: false,
          lines: { create: lines },
        },
        include: { lines: { include: { account: true } } },
      })
    })
    return NextResponse.json(entry)
  } catch (err) {
    return handleApiError(err, 'POST generate-entries')
  }
}
