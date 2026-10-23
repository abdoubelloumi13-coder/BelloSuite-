/**
 * Validation des écritures, états financiers et clôture d'exercice.
 *
 * Règles :
 *  - une écriture brouillon (isPosted = false) peut être supprimée ; une écriture validée est définitive ;
 *  - seules les écritures validées entrent dans les états financiers ;
 *  - la clôture exige : aucun brouillon dans l'exercice, balance équilibrée, exercices antérieurs clôturés.
 *    Elle passe une écriture « CLO » datée du dernier jour qui solde les classes 6 et 7 vers 131 / 135,
 *    puis verrouille l'exercice (toute nouvelle écriture y est alors refusée) ;
 *  - la réouverture supprime l'écriture de clôture, seulement si aucun exercice postérieur n'est clôturé.
 */
import { JournalType, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { ensureAccount } from '@/services/accounting'
import { validateEntryLines, nextEntryNumber } from '@/lib/journal-entry-logic'
import {
  buildBalanceSheet, buildIncomeStatement, buildClosingLines, r3,
  type StatementLineInput,
} from '@/lib/financial-statements'

export const CLOSING_JOURNAL_CODE = 'CLO'
export const closingReference = (periodId: string) => `CLOTURE:${periodId}`
const endOfDay = (d: Date) => new Date(d.getTime() + 86_399_999)

async function postedLines(
  db: Prisma.TransactionClient | typeof prisma,
  tenantId: string,
  date: { gte?: Date; lte?: Date },
  excludeClosing: boolean,
): Promise<StatementLineInput[]> {
  const rows = await db.journalEntryLine.findMany({
    where: {
      journalEntry: {
        tenantId,
        isPosted: true,
        ...(date.gte || date.lte ? { date } : {}),
        ...(excludeClosing ? { NOT: { reference: { startsWith: 'CLOTURE:' } } } : {}),
      },
    },
    select: { debit: true, credit: true, account: { select: { accountNumber: true, name: true } } },
  })
  return rows.map(r => ({
    accountNumber: r.account.accountNumber,
    accountName: r.account.name,
    debit: Number(r.debit),
    credit: Number(r.credit),
  }))
}

/** Bilan arrêté à `to` (cumulatif) + état de résultat de `from` à `to`. */
export async function getFinancialStatements(tenantId: string, params: { from: Date; to: Date }) {
  const to = endOfDay(params.to)
  const [balanceLines, resultLines, drafts] = await Promise.all([
    postedLines(prisma, tenantId, { lte: to }, false),
    postedLines(prisma, tenantId, { gte: params.from, lte: to }, true),
    prisma.journalEntry.count({ where: { tenantId, isPosted: false, date: { gte: params.from, lte: to } } }),
  ])
  return {
    from: params.from.toISOString().slice(0, 10),
    to: params.to.toISOString().slice(0, 10),
    bilan: buildBalanceSheet(balanceLines),
    resultat: buildIncomeStatement(resultLines),
    brouillonsNonValides: drafts,
  }
}

// ─── Validation / suppression des brouillons ───────────────────────────────

export async function validateEntries(tenantId: string, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 500)
  const entries = await prisma.journalEntry.findMany({
    where: { tenantId, id: { in: unique } },
    include: { period: { select: { isClosed: true, name: true } }, lines: { select: { accountId: true, debit: true, credit: true } } },
  })
  const validated: string[] = []
  const errors: { id: string; entryNumber?: string; error: string }[] = []
  for (const id of unique) {
    const e = entries.find(x => x.id === id)
    if (!e) { errors.push({ id, error: 'Écriture introuvable' }); continue }
    if (e.isPosted) continue
    if (e.period.isClosed) { errors.push({ id, entryNumber: e.entryNumber, error: `Exercice ${e.period.name} clôturé` }); continue }
    const err = validateEntryLines(e.lines.map(l => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })))
    if (err) { errors.push({ id, entryNumber: e.entryNumber, error: err }); continue }
    validated.push(id)
  }
  if (validated.length) {
    await prisma.journalEntry.updateMany({ where: { tenantId, id: { in: validated }, isPosted: false }, data: { isPosted: true } })
  }
  return { validated: validated.length, errors }
}

export async function deleteDraftEntry(tenantId: string, id: string) {
  const e = await prisma.journalEntry.findFirst({ where: { id, tenantId }, include: { period: { select: { isClosed: true } } } })
  if (!e) throw new BusinessError('Écriture introuvable', 404)
  if (e.isPosted) throw new BusinessError('Écriture validée : elle est définitive. Passez une écriture d\u2019extourne.', 409)
  if (e.period.isClosed) throw new BusinessError('Exercice clôturé : suppression impossible', 409)
  await prisma.journalEntry.delete({ where: { id } })
  return { deleted: true }
}

// ─── Clôture ───────────────────────────────────────────────────────────────

type Db = Prisma.TransactionClient | typeof prisma

async function closingChecks(db: Db, tenantId: string, periodId: string) {
  const period = await db.accountingPeriod.findFirst({ where: { id: periodId, tenantId } })
  if (!period) throw new BusinessError('Exercice introuvable', 404)

  const end = endOfDay(period.endDate)
  const [drafts, earlierOpen, lines] = await Promise.all([
    db.journalEntry.count({ where: { tenantId, periodId, isPosted: false } }),
    db.accountingPeriod.findMany({
      where: { tenantId, isClosed: false, endDate: { lt: period.startDate } },
      select: { name: true }, orderBy: { startDate: 'asc' },
    }),
    postedLines(db, tenantId, { gte: period.startDate, lte: end }, true),
  ])
  const totalDebit = r3(lines.reduce((s, l) => s + l.debit, 0))
  const totalCredit = r3(lines.reduce((s, l) => s + l.credit, 0))
  const closing = buildClosingLines(lines)

  const blockers: string[] = []
  if (period.isClosed) blockers.push('Exercice déjà clôturé')
  if (drafts > 0) blockers.push(`${drafts} écriture(s) en brouillon à valider ou supprimer`)
  if (earlierOpen.length) blockers.push(`Exercice(s) antérieur(s) non clôturé(s) : ${earlierOpen.map(p => p.name).join(', ')}`)
  if (Math.abs(totalDebit - totalCredit) >= 0.001) blockers.push(`Balance déséquilibrée : débit ${totalDebit.toFixed(3)} ≠ crédit ${totalCredit.toFixed(3)}`)

  return { period, drafts, totalDebit, totalCredit, closing, blockers }
}

export async function getClosingPreview(tenantId: string, periodId: string) {
  const c = await closingChecks(prisma, tenantId, periodId)
  const statements = buildIncomeStatement(
    (await postedLines(prisma, tenantId, { gte: c.period.startDate, lte: endOfDay(c.period.endDate) }, true)),
  )
  return {
    period: { id: c.period.id, name: c.period.name, startDate: c.period.startDate, endDate: c.period.endDate, isClosed: c.period.isClosed },
    canClose: c.blockers.length === 0,
    blockers: c.blockers,
    drafts: c.drafts,
    totalDebit: c.totalDebit,
    totalCredit: c.totalCredit,
    resultatNet: c.closing.result,
    resultatExploitation: statements.resultatExploitation,
    closingLines: c.closing.lines,
  }
}

export async function closeFiscalYear(tenantId: string, periodId: string) {
  return prisma.$transaction(async tx => {
    const c = await closingChecks(tx, tenantId, periodId)
    if (c.blockers.length) throw new BusinessError(`Clôture impossible : ${c.blockers.join(' ; ')}`, 409, { code: 'CLOSE_BLOCKED', blockers: c.blockers })

    let entryId: string | null = null
    if (c.closing.lines.length) {
      const journal = await tx.accountingJournal.upsert({
        where: { tenantId_code: { tenantId, code: CLOSING_JOURNAL_CODE } },
        update: {},
        create: { tenantId, code: CLOSING_JOURNAL_CODE, name: 'Clôture et à-nouveaux', type: JournalType.GENERAL },
      })
      const accountIds = new Map<string, string>()
      for (const l of c.closing.lines) {
        if (!accountIds.has(l.accountNumber)) accountIds.set(l.accountNumber, (await ensureAccount(tx, tenantId, l.accountNumber)).id)
      }
      const year = c.period.endDate.getFullYear()
      const existing = await tx.journalEntry.findMany({
        where: { tenantId, entryNumber: { startsWith: `${CLOSING_JOURNAL_CODE}-${year}-` } },
        select: { entryNumber: true },
      })
      const entry = await tx.journalEntry.create({
        data: {
          tenantId,
          journalId: journal.id,
          periodId: c.period.id,
          entryNumber: nextEntryNumber(CLOSING_JOURNAL_CODE, year, existing.map(e => e.entryNumber)),
          date: c.period.endDate,
          description: `Clôture de l'exercice ${c.period.name} — ${c.closing.result >= 0 ? 'bénéfice' : 'perte'} ${Math.abs(c.closing.result).toFixed(3)} TND`,
          reference: closingReference(c.period.id),
          isPosted: true,
          lines: {
            createMany: {
              data: c.closing.lines.map(l => ({ accountId: accountIds.get(l.accountNumber)!, debit: l.debit, credit: l.credit, description: 'Solde de clôture' })),
            },
          },
        },
      })
      entryId = entry.id
    }

    await tx.accountingPeriod.update({ where: { id: c.period.id }, data: { isClosed: true } })
    return { closed: true, periodId: c.period.id, resultatNet: c.closing.result, closingEntryId: entryId }
  })
}

export async function reopenFiscalYear(tenantId: string, periodId: string) {
  return prisma.$transaction(async tx => {
    const period = await tx.accountingPeriod.findFirst({ where: { id: periodId, tenantId } })
    if (!period) throw new BusinessError('Exercice introuvable', 404)
    if (!period.isClosed) throw new BusinessError('Exercice déjà ouvert', 409)
    const laterClosed = await tx.accountingPeriod.findFirst({
      where: { tenantId, isClosed: true, startDate: { gt: period.endDate } }, select: { name: true },
    })
    if (laterClosed) throw new BusinessError(`Rouvrez d'abord l'exercice ${laterClosed.name}`, 409)
    await tx.journalEntry.deleteMany({ where: { tenantId, periodId, reference: closingReference(periodId) } })
    await tx.accountingPeriod.update({ where: { id: periodId }, data: { isClosed: false } })
    return { reopened: true, periodId }
  })
}
