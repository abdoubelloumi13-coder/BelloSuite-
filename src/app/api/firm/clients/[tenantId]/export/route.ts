/**
 * GET /api/firm/clients/:tenantId/export?year=2026&month=9&kind=register|journal
 *  - register : registre des factures de vente et d'achat du mois (HT, FODEC, TVA, timbre, TTC, RS)
 *  - journal  : écritures comptables du mois, une ligne par mouvement
 * CSV pour Excel (séparateur « ; », virgule décimale, UTF-8 avec BOM). Réservé aux membres du cabinet ayant un accès actif.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession } from '@/lib/api-auth'
import { handleApiError } from '@/lib/errors'
import { firmHasActiveAccess, getFirmMembership } from '@/lib/firm-access'
import { registerRows } from '@/lib/firm-dashboard'
import { journalToCsv, monthRange, registerToCsv } from '@/lib/firm-logic'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const session = await requireSession(req)
    if (session instanceof NextResponse) return session
    const { tenantId } = await params
    const m = await getFirmMembership(session.id)
    if (!m || !(await firmHasActiveAccess(m.firmId, tenantId))) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const sp = new URL(req.url).searchParams
    const year = Number(sp.get('year')), month = Number(sp.get('month'))
    const kind = sp.get('kind') === 'journal' ? 'journal' : 'register'
    if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Période invalide' }, { status: 400 })
    }

    let csv: string
    if (kind === 'journal') {
      const entries = await prisma.journalEntry.findMany({
        where: { tenantId, date: monthRange(year, month) },
        orderBy: [{ date: 'asc' }, { entryNumber: 'asc' }],
        select: {
          date: true, entryNumber: true, reference: true, description: true, journal: { select: { code: true } },
          lines: { select: { debit: true, credit: true, description: true, account: { select: { accountNumber: true, name: true } } } },
        },
      })
      csv = journalToCsv(entries)
    } else {
      csv = registerToCsv(await registerRows(tenantId, year, month))
    }
    const name = `${kind === 'journal' ? 'journal' : 'registre'}-${year}-${String(month).padStart(2, '0')}.csv`
    return new NextResponse(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    return handleApiError(err, 'GET firm/clients/export')
  }
}
