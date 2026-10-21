import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { assertAllBelongToTenant } from '@/lib/tenant-scope'
import { parseDateParam } from '@/lib/ledger'
import { validateEntryLines, nextEntryNumber, round3 } from '@/lib/journal-entry-logic'

const amount = z.preprocess(v => (v === '' || v == null ? 0 : v), z.coerce.number().finite().min(0))

export const manualEntrySchema = z.object({
  journalId: z.string().min(1, 'journal requis'),
  periodId: z.preprocess(v => (v === '' ? undefined : v), z.string().optional()),
  date: z.string().min(1, 'date requise'),
  description: z.string().trim().min(1, 'libellé requis'),
  reference: z.preprocess(v => (typeof v === 'string' && !v.trim() ? null : v), z.string().nullable().optional()),
  entryNumber: z.preprocess(v => (typeof v === 'string' && !v.trim() ? undefined : v), z.string().optional()),
  lines: z.array(z.object({
    accountId: z.string(),
    debit: amount,
    credit: amount,
    description: z.string().nullable().optional(),
  })).min(2, 'au moins deux lignes'),
})
export type ManualEntryData = z.infer<typeof manualEntrySchema>

export async function listJournalEntries(
  tenantId: string,
  params: { journalId?: string; periodId?: string; startDate?: string; endDate?: string; take?: number } = {}
) {
  const start = parseDateParam(params.startDate)
  const end = parseDateParam(params.endDate)
  const where: Prisma.JournalEntryWhereInput = {
    tenantId,
    ...(params.journalId ? { journalId: params.journalId } : {}),
    ...(params.periodId ? { periodId: params.periodId } : {}),
    ...(start || end ? { date: { ...(start && { gte: start }), ...(end && { lte: new Date(end.getTime() + 86_399_999) }) } } : {}),
  }
  const entries = await prisma.journalEntry.findMany({
    where,
    include: {
      journal: { select: { id: true, code: true, name: true } },
      period: { select: { id: true, name: true, isClosed: true } },
      lines: { include: { account: { select: { id: true, accountNumber: true, name: true } } } },
    },
    orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
    take: Math.min(params.take ?? 200, 500),
  })
  return entries.map(e => ({
    ...e,
    lines: e.lines.map(l => ({ ...l, debit: Number(l.debit), credit: Number(l.credit) })),
    totalDebit: round3(e.lines.reduce((s, l) => s + Number(l.debit), 0)),
    totalCredit: round3(e.lines.reduce((s, l) => s + Number(l.credit), 0)),
  }))
}

export async function createManualEntry(tenantId: string, data: ManualEntryData) {
  const lines = data.lines.filter(l => round3(l.debit) !== 0 || round3(l.credit) !== 0)
  const err = validateEntryLines(lines)
  if (err) throw new BusinessError(err, 400)

  const date = parseDateParam(data.date)
  if (!date) throw new BusinessError('Date invalide', 400)

  const journal = await prisma.accountingJournal.findFirst({ where: { id: data.journalId, tenantId } })
  if (!journal) throw new BusinessError('Journal introuvable', 404)

  // Période : celle choisie (du tenant) ou celle qui contient la date
  const period = data.periodId
    ? await prisma.accountingPeriod.findFirst({ where: { id: data.periodId, tenantId } })
    : await prisma.accountingPeriod.findFirst({ where: { tenantId, startDate: { lte: date }, endDate: { gte: date } }, orderBy: { startDate: 'desc' } })
  if (!period) throw new BusinessError('Aucun exercice ouvert ne couvre cette date : créez-le dans « Exercices »', 400)
  if (period.isClosed) throw new BusinessError('Exercice clôturé : saisie impossible', 409)
  if (date < period.startDate || date > new Date(period.endDate.getTime() + 86_399_999)) {
    throw new BusinessError('La date est hors de l\u2019exercice choisi', 400)
  }

  await assertAllBelongToTenant('accountingAccount', lines.map(l => l.accountId), tenantId)

  let entryNumber = data.entryNumber
  if (!entryNumber) {
    const year = date.getFullYear()
    const existing = await prisma.journalEntry.findMany({
      where: { tenantId, entryNumber: { startsWith: `${journal.code}-${year}-` } },
      select: { entryNumber: true },
    })
    entryNumber = nextEntryNumber(journal.code, year, existing.map(e => e.entryNumber))
  }

  try {
    return await prisma.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber,
        date,
        description: data.description,
        reference: data.reference ?? null,
        lines: {
          createMany: {
            data: lines.map(l => ({ accountId: l.accountId, debit: round3(l.debit), credit: round3(l.credit), description: l.description || null })),
          },
        },
      },
      include: { lines: true },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new BusinessError(`Le numéro d'écriture ${entryNumber} est déjà utilisé`, 409)
    }
    throw e
  }
}
