import { z } from 'zod'
import { prisma } from '@/lib/db'
import { AccountType, JournalType, Prisma } from '@prisma/client'
import { buildLedger, parseDateParam, type LedgerResult } from '@/lib/ledger'
import { computeVatDeclaration, monthRange, SALES_VAT_TYPES, EXCLUDED_SALE_STATUSES } from '@/lib/vat-declaration'
import { PURCHASE_INVOICE_TYPES } from '@/lib/firm-dashboard'
import { assertBelongsToTenant, assertAllBelongToTenant } from '@/lib/tenant-scope'
import { BusinessError } from '@/lib/errors'
import { TN_ACCOUNTS, findChartAccount, TUNISIAN_CHART_OF_ACCOUNTS } from '@/lib/tunisian-chart-of-accounts'
import { buildAutoEntryLines, buildEntryDescription, computeSettlement, isPostableSaleType, PAYABLE_SALE_TYPES, SettlementError } from '@/lib/accounting-auto'
import { r3 } from '@/lib/fiscal'

type Db = Prisma.TransactionClient | typeof prisma

/** Compte du plan tunisien : trouvé chez le tenant ou créé à la volée (libellé/type du plan officiel). */
export async function ensureAccount(db: Db, tenantId: string, accountNumber: string) {
  const node = findChartAccount(accountNumber)
  return db.accountingAccount.upsert({
    where: { tenantId_accountNumber: { tenantId, accountNumber } },
    update: {},
    create: { tenantId, accountNumber, name: node?.name ?? `Compte ${accountNumber}`, type: (node?.type ?? 'ASSET') as AccountType },
  })
}

const JOURNAL_DEFAULTS: Record<string, { name: string; type: JournalType }> = {
  VT: { name: 'Ventes', type: JournalType.SALES },
  AC: { name: 'Achats', type: JournalType.PURCHASES },
  BQ: { name: 'Banque', type: JournalType.BANK },
  CS: { name: 'Caisse', type: JournalType.CASH },
  OD: { name: 'Opérations Diverses', type: JournalType.GENERAL },
}

/** Journal par code (VT, AC, BQ, CS, OD) : créé s'il n'existe pas encore. */
export async function ensureJournal(db: Db, tenantId: string, code: keyof typeof JOURNAL_DEFAULTS) {
  const d = JOURNAL_DEFAULTS[code]
  return db.accountingJournal.upsert({
    where: { tenantId_code: { tenantId, code } },
    update: {},
    create: { tenantId, code, name: d.name, type: d.type },
  })
}

/** Exercice couvrant la date (sinon exercice civil créé). Refuse un exercice clôturé. */
export async function ensurePeriodFor(db: Db, tenantId: string, date: Date) {
  let period = await db.accountingPeriod.findFirst({
    where: { tenantId, startDate: { lte: date }, endDate: { gte: date } },
    orderBy: { startDate: 'desc' },
  })
  if (!period) {
    const year = date.getFullYear()
    period = await db.accountingPeriod.upsert({
      where: { tenantId_name: { tenantId, name: `${year}` } },
      update: {},
      create: { tenantId, name: `${year}`, startDate: new Date(`${year}-01-01`), endDate: new Date(`${year}-12-31`) },
    })
  }
  if (period.isClosed) throw new BusinessError(`Exercice ${period.name} clôturé : écriture impossible`, 409)
  return period
}

// ─── Zod Schemas ────────────────────────────────────────────

export const journalEntrySchema = z.object({
  tenantId: z.string().min(1),
  journalId: z.string().min(1),
  periodId: z.string().min(1),
  entryNumber: z.string().min(1),
  date: z.string().or(z.date()),
  description: z.string().min(1),
  reference: z.string().optional().nullable(),
  lines: z.array(z.object({
    accountId: z.string().min(1),
    debit: z.number().default(0),
    credit: z.number().default(0),
    description: z.string().optional().nullable(),
  })).min(2),
})

export type JournalEntryData = z.infer<typeof journalEntrySchema>

// ─── Service Functions ──────────────────────────────────────

export async function getChartOfAccounts(tenantId: string) {
  return prisma.accountingAccount.findMany({
    where: { tenantId, isActive: true },
    orderBy: { accountNumber: 'asc' },
  })
}

export async function getJournals(tenantId: string) {
  return prisma.accountingJournal.findMany({
    where: { tenantId, isActive: true },
    orderBy: { code: 'asc' },
  })
}

export async function getPeriods(tenantId: string) {
  return prisma.accountingPeriod.findMany({
    where: { tenantId },
    orderBy: { startDate: 'desc' },
  })
}

/**
 * Complète le plan comptable d'un tenant EXISTANT avec les comptes du modèle tunisien qui lui manquent
 * (ex. 431, 4368, 4371 ajoutés au modèle après la création du tenant). Idempotent : une seule lecture
 * des numéros existants (actifs ou non), puis createMany skipDuplicates sur l'unique (tenantId, accountNumber).
 * Ne touche jamais aux comptes existants (libellé, statut). Ne fait rien pour un plan vide (onboarding).
 */
export async function syncTunisianChartOfAccounts(tenantId: string, opts: { evenIfEmpty?: boolean } = {}, db: Db = prisma) {
  const existing = await db.accountingAccount.findMany({ where: { tenantId }, select: { accountNumber: true } })
  if (existing.length === 0 && !opts.evenIfEmpty) return { created: 0, missing: [] as string[] }
  const have = new Set(existing.map(a => a.accountNumber))
  const missing = TUNISIAN_CHART_OF_ACCOUNTS.filter(a => !have.has(a.accountNumber))
  if (missing.length === 0) return { created: 0, missing: [] as string[] }
  const res = await db.accountingAccount.createMany({
    data: missing.map(a => ({ tenantId, accountNumber: a.accountNumber, name: a.name, type: a.type as AccountType })),
    skipDuplicates: true,
  })
  return { created: res.count, missing: missing.map(a => a.accountNumber) }
}

/**
 * Initialize a standard Tunisian Chart of Accounts for a new tenant.
 */
export async function initChartOfAccounts(tenantId: string) {
  // Comptes clés du plan comptable tunisien utilisés par les écritures automatiques
  const standardNumbers = ['101', '221', ...Object.values(TN_ACCOUNTS), '701']
  const standardAccounts = [...new Set(standardNumbers)].map((num) => {
    const node = findChartAccount(num)
    return { num, name: node?.name ?? `Compte ${num}`, type: (node?.type ?? 'ASSET') as AccountType }
  })

  const journals = [
    { code: 'VT', name: 'Ventes', type: JournalType.SALES },
    { code: 'AC', name: 'Achats', type: JournalType.PURCHASES },
    { code: 'BQ', name: 'Banque', type: JournalType.BANK },
    { code: 'CS', name: 'Caisse', type: JournalType.CASH },
    { code: 'OD', name: 'Opérations Diverses', type: JournalType.GENERAL },
  ]

  return prisma.$transaction(async (tx) => {
    // 1. Create accounts
    for (const acc of standardAccounts) {
      await tx.accountingAccount.upsert({
        where: { tenantId_accountNumber: { tenantId, accountNumber: acc.num } },
        update: {},
        create: { 
          tenantId, 
          accountNumber: acc.num, 
          name: acc.name, 
          type: acc.type 
        }
      })
    }

    // 2. Create journals
    for (const j of journals) {
      await tx.accountingJournal.upsert({
        where: { tenantId_code: { tenantId, code: j.code } },
        update: {},
        create: { 
          tenantId, 
          code: j.code, 
          name: j.name, 
          type: j.type 
        }
      })
    }
  })
}

export async function createJournalEntry(data: JournalEntryData) {
  // 1. Validate balance
  const totalDebit = data.lines.reduce((sum, l) => sum + l.debit, 0)
  const totalCredit = data.lines.reduce((sum, l) => sum + l.credit, 0)

  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    throw new BusinessError('L\'écriture n\'est pas équilibrée (Débit != Crédit)', 400)
  }

  // Journal, période et comptes : uniquement ceux du tenant (anti-IDOR)
  await assertBelongsToTenant('accountingJournal', data.journalId, data.tenantId)
  await assertBelongsToTenant('accountingPeriod', data.periodId, data.tenantId)
  await assertAllBelongToTenant('accountingAccount', data.lines.map((l) => l.accountId), data.tenantId)

  return prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        tenantId: data.tenantId,
        journalId: data.journalId,
        periodId: data.periodId,
        entryNumber: data.entryNumber,
        date: new Date(data.date),
        description: data.description,
        reference: data.reference,
        lines: {
          createMany: {
            data: data.lines.map(l => ({
              accountId: l.accountId,
              debit: l.debit,
              credit: l.credit,
              description: l.description
            }))
          }
        }
      },
      include: { lines: true }
    })

    return entry
  })
}

/**
 * Écriture d'une facture / d'un avoir de vente (journal VT). Devis, bons de commande et bons de
 * livraison n'ont PAS d'écriture. Idempotent : une seule écriture par document (Invoice.accountingEntryId),
 * liaison conditionnelle (accountingEntryId IS NULL) dans la transaction → deux appels simultanés ne
 * peuvent pas créer deux écritures.
 *  - posted = true  (POST /invoices/[id]/post) : écriture validée ; si un brouillon existe, il est validé.
 *  - posted = false (generate-entries) : brouillon ; si une écriture existe déjà, elle est renvoyée.
 */
export async function generateInvoiceEntry(invoiceId: string, tenantId: string, opts: { posted: boolean }) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, tenantId },
      include: { client: true },
    })
    if (!invoice) throw new BusinessError('Facture introuvable', 404)
    if (!isPostableSaleType(invoice.type)) {
      throw new BusinessError('Seules les factures et les avoirs sont comptabilisés (devis, bons de commande et bons de livraison : aucune écriture)', 400, { code: 'NOT_POSTABLE' })
    }
    if (invoice.status === 'CANCELLED' || invoice.status === 'DRAFT') {
      throw new BusinessError('Document brouillon ou annulé : comptabilisation impossible', 409)
    }

    if (invoice.accountingEntryId) {
      const existing = await tx.journalEntry.findFirst({
        where: { id: invoice.accountingEntryId, tenantId },
        include: { lines: { include: { account: true } } },
      })
      if (existing) {
        if (!opts.posted) return Object.assign(existing, { alreadyExists: true })
        if (existing.isPosted) throw new BusinessError('Facture déjà comptabilisée', 409, { code: 'ALREADY_POSTED', entryId: existing.id })
        return tx.journalEntry.update({ where: { id: existing.id }, data: { isPosted: true }, include: { lines: { include: { account: true } } } })
      }
      // écriture liée supprimée entre-temps : on régénère
    }

    // Lignes selon le plan tunisien (411 / 707|705, 4371 FODEC, 4367 TVA, 4368 timbre) — voir lib/accounting-auto
    const built = buildAutoEntryLines(invoice)
    if (!built.lines.length) throw new BusinessError('Montants nuls : aucune écriture à générer', 400)
    if (!built.balanced) throw new BusinessError('Montants de la facture incohérents (HT + FODEC + TVA + timbre ≠ TTC)', 400)

    const journal = await ensureJournal(tx, tenantId, 'VT')
    const period = await ensurePeriodFor(tx, tenantId, invoice.date)
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = []
    for (const l of built.lines) {
      const acc = await ensureAccount(tx, tenantId, l.account)
      lines.push({ accountId: acc.id, debit: l.debit, credit: l.credit, description: `${l.label} — ${invoice.number}${invoice.client?.name ? ` — ${invoice.client.name}` : ''}` })
    }

    // Numéro d'écriture stable par document (unique tenant + entryNumber)
    const baseNumber = `VT-${invoice.number}`
    const taken = await tx.journalEntry.findFirst({ where: { tenantId, entryNumber: baseNumber }, select: { id: true } })
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber: taken ? `${baseNumber}-${Date.now().toString(36).toUpperCase()}` : baseNumber,
        date: invoice.date,
        description: buildEntryDescription(invoice),
        isPosted: opts.posted,
        lines: { createMany: { data: lines } },
      },
      include: { lines: { include: { account: true } } },
    })

    const linked = await tx.invoice.updateMany({
      where: { id: invoice.id, tenantId, accountingEntryId: invoice.accountingEntryId ?? null },
      data: { accountingEntryId: entry.id },
    })
    if (linked.count !== 1) throw new BusinessError('Facture comptabilisée simultanément : réessayez', 409)
    return entry
  })
}

export async function postInvoiceToAccounting(invoiceId: string, tenantId: string) {
  return generateInvoiceEntry(invoiceId, tenantId, { posted: true })
}

export const paymentSchema = z.object({
  method: z.enum(['CASH', 'BANK']).default('BANK'),
  /** Montant encaissé (défaut : le reste dû, net de la RS subie) */
  amount: z.coerce.number().min(0, 'Montant invalide').optional().nullable(),
  /** Retenue à la source subie, opérée par le client (certificat à recevoir) */
  rsAmount: z.coerce.number().min(0, 'Retenue invalide').optional().nullable(),
  date: z.string().optional().nullable(),
})
export type PaymentInput = z.infer<typeof paymentSchema>

/**
 * Règlement d'une facture de vente : total ou partiel, avec RS subie éventuelle (4341).
 * Verrou de la facture (FOR UPDATE) ; le reste dû tient compte des règlements précédents
 * (Invoice.amountSettled) et des avoirs actifs liés. Statut PAID quand la facture est soldée.
 */
export async function postPaymentToAccounting(
  invoiceId: string,
  tenantId: string,
  input: 'CASH' | 'BANK' | PaymentInput = 'BANK',
) {
  const opts: PaymentInput = typeof input === 'string' ? { method: input } : input
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "tenantId" = ${tenantId} FOR UPDATE`
    const invoice = await tx.invoice.findFirst({ where: { id: invoiceId, tenantId }, include: { client: true } })
    if (!invoice) throw new BusinessError('Facture introuvable', 404)
    if (!PAYABLE_SALE_TYPES.includes(invoice.type)) throw new BusinessError('Seules les factures peuvent être réglées', 400, { code: 'NOT_PAYABLE' })
    if (invoice.status === 'CANCELLED' || invoice.status === 'DRAFT') throw new BusinessError('Facture brouillon ou annulée', 409)

    const credits = await tx.invoice.findMany({
      // TODO prisma generate : originalInvoiceId ajouté par la migration 20261022000100
      where: { tenantId, type: 'CREDIT_NOTE', status: { notIn: ['CANCELLED', 'REJECTED'] }, originalInvoiceId: invoice.id } as any,
      select: { subtotalHT: true, totalFodec: true, totalVAT: true },
    })
    const credited = credits.reduce((s, c) => s + Number(c.subtotalHT) + Number(c.totalFodec) + Number(c.totalVAT), 0)
    // TODO prisma generate : amountSettled ajouté par la migration 20261022000100
    const alreadySettled = Number((invoice as any).amountSettled ?? 0) || (invoice.status === 'PAID' ? Number(invoice.totalTTC) : 0)

    let settlement: ReturnType<typeof computeSettlement>
    try {
      settlement = computeSettlement({
        totalTTC: Number(invoice.totalTTC), alreadySettled, credited,
        amount: opts.amount, rsAmount: opts.rsAmount, method: opts.method,
      })
    } catch (e) {
      if (e instanceof SettlementError) throw new BusinessError(e.message, e.status, e.field ? { field: e.field } : undefined)
      throw e
    }

    const date = opts.date ? new Date(opts.date) : new Date()
    if (Number.isNaN(date.getTime())) throw new BusinessError('Date invalide', 400, { field: 'date' })
    const journal = await ensureJournal(tx, tenantId, opts.method === 'CASH' ? 'CS' : 'BQ')
    const period = await ensurePeriodFor(tx, tenantId, date)
    const lines = []
    for (const l of settlement.lines) {
      const acc = await ensureAccount(tx, tenantId, l.account)
      lines.push({ accountId: acc.id, debit: l.debit, credit: l.credit, description: `${l.label} — ${invoice.number}` })
    }
    const previousPayments = await tx.journalEntry.count({ where: { tenantId, entryNumber: { startsWith: `PAY-${invoice.number}` } } })
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber: previousPayments ? `PAY-${invoice.number}-${previousPayments + 1}` : `PAY-${invoice.number}`,
        date,
        description: `${settlement.fullyPaid ? 'Règlement' : 'Règlement partiel'} facture ${invoice.number}${settlement.rsAmount ? ` (RS subie ${settlement.rsAmount.toFixed(3)} DT)` : ''}`,
        isPosted: true,
        lines: { create: lines },
      },
      include: { lines: true },
    })

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        ...(settlement.fullyPaid ? { status: 'PAID' as const } : {}),
        paymentEntryId: entry.id,
        // TODO prisma generate : amountSettled ajouté par la migration 20261022000100
        ...({ amountSettled: r3(alreadySettled + settlement.settled) } as Record<string, unknown>),
      } as any,
    })

    return Object.assign(entry, {
      settlement: { amount: settlement.amount, rsAmount: settlement.rsAmount, remaining: settlement.remainingAfter, fullyPaid: settlement.fullyPaid },
    })
  })
}

export async function postPurchaseToAccounting(purchaseOrderId: string, tenantId: string) {
  return prisma.$transaction(async (tx) => {
    // 1. Get purchase order
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { supplier: true, items: true }
    })

    if (!po || po.tenantId !== tenantId) throw new BusinessError('Bon de commande fournisseur introuvable', 404)
    if (po.accountingEntryId) throw new BusinessError('Achat déjà comptabilisé', 409)
    // Seules les factures fournisseurs sont comptabilisées (un bon de commande n'engage pas la comptabilité)
    if (!PURCHASE_INVOICE_TYPES.includes(po.type)) {
      throw new BusinessError('Seules les factures fournisseurs sont comptabilisées (bon de commande / réception : aucune écriture)', 400, { code: 'NOT_POSTABLE' })
    }
    if (po.status === 'CANCELLED') throw new BusinessError('Facture fournisseur annulée : comptabilisation impossible', 409)

    // 2. Comptes tunisiens (mêmes que lib/purchase-review) : 607 achats, 4366 TVA déductible, 665 timbre, 401 fournisseurs
    const ht = r3(Number(po.subtotal) || 0)
    const vat = r3(Number(po.taxAmount) || 0)
    const ttc = r3(Number(po.total) || 0)
    const other = r3(ttc - ht - vat) // timbre (et éventuels frais) inclus dans le TTC

    const journal = await ensureJournal(tx, tenantId, 'AC')
    const period = await ensurePeriodFor(tx, tenantId, po.date)

    // 5. Prepare lines
    const lines = [
      { accountId: (await ensureAccount(tx, tenantId, TN_ACCOUNTS.PURCHASES_GOODS)).id, debit: ht, credit: 0, description: `Achat ${po.number}` },
    ]
    if (vat > 0) lines.push({ accountId: (await ensureAccount(tx, tenantId, TN_ACCOUNTS.VAT_DEDUCTIBLE)).id, debit: vat, credit: 0, description: `TVA déductible sur ${po.number}` })
    if (other > 0) lines.push({ accountId: (await ensureAccount(tx, tenantId, TN_ACCOUNTS.STAMP_EXPENSE)).id, debit: other, credit: 0, description: `Timbre fiscal ${po.number}` })
    lines.push({ accountId: (await ensureAccount(tx, tenantId, TN_ACCOUNTS.SUPPLIERS)).id, debit: 0, credit: r3(ht + vat + Math.max(0, other)), description: `Dette fournisseur ${po.number}` })

    // 6. Create Journal Entry
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber: `ACH-${po.number}`,
        date: po.date,
        description: `Comptabilisation Achat ${po.number}`,
        lines: {
          createMany: { data: lines }
        }
      }
    })

    // 7. Liaison conditionnelle : un seul appel gagne si deux comptabilisations sont simultanées
    const linked = await tx.purchaseOrder.updateMany({
      where: { id: purchaseOrderId, tenantId, accountingEntryId: null },
      data: { accountingEntryId: entry.id }
    })
    if (linked.count !== 1) throw new BusinessError('Achat déjà comptabilisé', 409)

    return entry
  })
}

export async function postPayrollToAccounting(month: number, year: number, tenantId: string) {
  return prisma.$transaction(async (tx) => {
    // 1. Get all payslips for the period
    const payslips = await tx.paySlip.findMany({
      where: { tenantId, mois: month, annee: year, statut: 'PENDING' }
    })

    if (payslips.length === 0) throw new BusinessError('Aucun bulletin de paie en attente trouvé pour cette période', 400)
    if (payslips.some(p => p.accountingEntryId)) throw new BusinessError('Certains bulletins sont déjà comptabilisés', 409)

    // 2. Aggregate amounts
    const totals = payslips.reduce((acc, p) => ({
      gross: acc.gross + Number(p.brutGlobal),
      cnss: acc.cnss + Number(p.cnssSalaire),
      irpp: acc.irpp + Number(p.irpp),
      net: acc.net + Number(p.netAPayer),
    }), { gross: 0, cnss: 0, irpp: 0, net: 0 })

    // 3. Comptes tunisiens : 640 salaires bruts / 431 CNSS, 4342 retenues sur salaires (IRPP), 425 rémunérations dues
    const acc641 = await ensureAccount(tx, tenantId, TN_ACCOUNTS.SALARIES)
    const acc431 = await ensureAccount(tx, tenantId, TN_ACCOUNTS.CNSS)
    const acc432 = await ensureAccount(tx, tenantId, TN_ACCOUNTS.PAYROLL_WITHHOLDING)
    const acc421 = await ensureAccount(tx, tenantId, TN_ACCOUNTS.PERSONNEL_DUE)

    // 4. Journal OD et exercice
    const journal = await ensureJournal(tx, tenantId, 'OD')
    const period = await ensurePeriodFor(tx, tenantId, new Date(year, month - 1, 28))

    // 6. Create Journal Entry
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber: `PAIE-${year}-${month.toString().padStart(2, '0')}`,
        date: new Date(),
        description: `Centralisation Paie ${month}/${year}`,
        lines: {
          create: [
            { accountId: acc641.id, debit: totals.gross, credit: 0, description: `Salaires Bruts ${month}/${year}` },
            { accountId: acc431.id, debit: 0, credit: totals.cnss, description: `CNSS Salariale ${month}/${year}` },
            { accountId: acc432.id, debit: 0, credit: totals.irpp, description: `IRPP Salariale ${month}/${year}` },
            { accountId: acc421.id, debit: 0, credit: totals.net, description: `Salaires Nets à payer ${month}/${year}` },
          ]
        }
      }
    })

    // 7. Update payslips
    await tx.paySlip.updateMany({
      where: { id: { in: payslips.map(p => p.id) } },
      data: { accountingEntryId: entry.id }
    })

    return entry
  })
}

export async function getVATSummary(month: number, year: number, tenantId: string) {
  const startDate = new Date(year, month - 1, 1)
  const endDate = new Date(year, month, 0, 23, 59, 59)

  // 1. Get Collected VAT (Ventes)
  const collectedLines = await prisma.journalEntryLine.findMany({
    where: {
      journalEntry: {
        tenantId,
        date: { gte: startDate, lte: endDate },
        NOT: { entryNumber: { startsWith: 'LIQ-TVA-' } },
      },
      account: { accountNumber: TN_ACCOUNTS.VAT_COLLECTED }
    }
  })

  // 2. Get Deductible VAT (Achats)
  const deductibleLines = await prisma.journalEntryLine.findMany({
    where: {
      journalEntry: {
        tenantId,
        date: { gte: startDate, lte: endDate },
        NOT: { entryNumber: { startsWith: 'LIQ-TVA-' } },
      },
      account: { accountNumber: TN_ACCOUNTS.VAT_DEDUCTIBLE }
    }
  })

  // Soldes des comptes 4367 (TVA collectée, créditeur) et 4366 (TVA déductible, débiteur) hors écritures de liquidation
  const collectedTotal = Math.round(collectedLines.reduce((sum: number, line) => sum + Number(line.credit) - Number(line.debit), 0) * 1000) / 1000
  const deductibleTotal = Math.round(deductibleLines.reduce((sum: number, line) => sum + Number(line.debit) - Number(line.credit), 0) * 1000) / 1000

  return {
    month,
    year,
    collectedVAT: collectedTotal,
    deductibleVAT: deductibleTotal,
    netVAT: collectedTotal - deductibleTotal,
    status: (collectedTotal - deductibleTotal) > 0 ? 'TO_PAY' : 'CREDIT'
  }
}

/** Déclaration mensuelle de TVA à partir des documents (ventes, avoirs, factures fournisseurs) — voir lib/vat-declaration. */
export async function getVATDeclaration(month: number, year: number, tenantId: string, previousCredit = 0) {
  const { start, end } = monthRange(month, year)
  const [sales, purchases] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, type: { in: [...SALES_VAT_TYPES] }, status: { notIn: [...EXCLUDED_SALE_STATUSES] }, date: { gte: start, lte: end } },
      select: { type: true, totalFodec: true, totalVAT: true, timbreFiscal: true, subtotalHT: true, items: { select: { vatRate: true, vatAmount: true, totalHT: true, fodecAmount: true } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, type: { in: PURCHASE_INVOICE_TYPES }, status: { notIn: ['CANCELLED', 'DRAFT'] }, date: { gte: start, lte: end } },
      select: { subtotal: true, taxAmount: true, total: true },
    }),
  ])
  return computeVatDeclaration({ month, year, sales, purchases, previousCredit })
}

export async function postVATLiquidationToAccounting(month: number, year: number, tenantId: string) {
  return prisma.$transaction(async (tx) => {
    const summary = await getVATSummary(month, year, tenantId)
    
    const r3 = (n: number) => Math.round(n * 1000) / 1000
    const collected = r3(summary.collectedVAT)
    const deductible = r3(summary.deductibleVAT)
    if (collected <= 0 && deductible <= 0) throw new BusinessError('Aucune TVA à liquider sur cette période', 400)

    const journal = await ensureJournal(tx, tenantId, 'OD')
    const date = new Date(year, month, 0) // dernier jour du mois
    const period = await ensurePeriodFor(tx, tenantId, date)
    const acc4367 = await ensureAccount(tx, tenantId, TN_ACCOUNTS.VAT_COLLECTED)
    const acc4366 = await ensureAccount(tx, tenantId, TN_ACCOUNTS.VAT_DEDUCTIBLE)
    const acc4365 = await ensureAccount(tx, tenantId, TN_ACCOUNTS.VAT_PAYABLE)

    // Solde 4367 contre 4366 ; TVA due → 4365 ; un crédit de TVA reste au débit du 4366 (report)
    const offset = r3(Math.min(collected, deductible))
    const lines: Array<{ accountId: string; debit: number; credit: number; description: string }> = []
    if (collected > 0) lines.push({ accountId: acc4367.id, debit: collected, credit: 0, description: `Liquidation TVA collectée ${month}/${year}` })
    if (offset > 0) lines.push({ accountId: acc4366.id, debit: 0, credit: offset, description: `Imputation TVA déductible ${month}/${year}` })
    if (collected - offset > 0) lines.push({ accountId: acc4365.id, debit: 0, credit: r3(collected - offset), description: `TVA à décaisser ${month}/${year}` })
    if (lines.length < 2) throw new BusinessError('Crédit de TVA : rien à liquider, le crédit reste reporté au 4366', 400)

    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber: `LIQ-TVA-${year}-${month.toString().padStart(2, '0')}`,
        date,
        description: `Liquidation de TVA - Mois ${month}/${year}`,
        lines: {
          create: lines
        }
      }
    })

    return entry
  })
}

export async function getTrialBalance(tenantId: string, params: { startDate?: string; endDate?: string } = {}) {
  const { startDate, endDate } = params

  // JournalEntryLine n'a pas de colonne tenantId : le filtre passe par l'écriture parente.
  const where: any = { journalEntry: { tenantId } }
  if (startDate || endDate) {
    where.journalEntry = {
      tenantId,
      date: {
        ...(startDate && { gte: new Date(startDate) }),
        ...(endDate && { lte: new Date(endDate) }),
      }
    }
  }

  const lines = await prisma.journalEntryLine.findMany({
    where,
    include: { account: true }
  })

  // Group by account
  const balanceMap = new Map<string, any>()

  for (const line of lines) {
    const acc = line.account
    if (!balanceMap.has(acc.id)) {
      balanceMap.set(acc.id, {
        id: acc.id,
        accountNumber: acc.accountNumber,
        name: acc.name,
        debit: 0,
        credit: 0,
        balance: 0
      })
    }

    const entry = balanceMap.get(acc.id)
    entry.debit += Number(line.debit)
    entry.credit += Number(line.credit)
    entry.balance = entry.debit - entry.credit
  }

  return Array.from(balanceMap.values()).sort((a, b) => a.accountNumber.localeCompare(b.accountNumber))
}

export async function postAmortizationToAccounting(month: number, year: number, tenantId: string) {
  return prisma.$transaction(async (tx) => {
    // 1. Get active assets that are not fully amortized
    const assets = await tx.asset.findMany({
      where: {
        tenantId,
        isActive: true,
        // NOT fully amortized: accumulatedAmortization < (purchaseValue - salvageValue)
        // We'll compute in JavaScript for simplicity, but could be done in Prisma with a filter
        // We'll fetch all active assets and filter later
      },
    });

    // Filter out assets that are fully amortized
    const activeAssets = assets.filter(asset => {
      const purchaseValueNum = Number(asset.purchaseValue ?? 0);
      const salvageValueNum = Number(asset.salvageValue ?? 0);
      const accumulatedAmortizationNum = Number(asset.accumulatedAmortization);
      const depreciableBase = purchaseValueNum - salvageValueNum;
      return accumulatedAmortizationNum < depreciableBase;
    });

    if (activeAssets.length === 0) {
      throw new Error('No active assets found for amortization');
    }

     // 2. Calculate monthly amortization for each asset and prepare lines
     const lines = [];
     let totalAmortization = 0;

     for (const asset of activeAssets) {
       const purchaseValueNum = Number(asset.purchaseValue ?? 0);
       const salvageValueNum = Number(asset.salvageValue ?? 0);
       const usefulLifeNum = Number(asset.usefulLife ?? 1);
       const depreciableBase = purchaseValueNum - salvageValueNum;
       const annualAmortization = depreciableBase / usefulLifeNum;
       const monthlyAmortization = annualAmortization / 12;

       // We'll accumulate the total amortization to create a single journal entry line per account?
       // But the plan says to generate an entry in the journal OD. It doesn't specify if it's one entry per asset or one entry for all.
       // We'll follow the pattern of other functions: one journal entry for the batch.
       // So we will create two lines: one for debit (681) and one for credit (28) for the total.

       totalAmortization += monthlyAmortization;
     }

    // 3. Find target accounts: 681 (Dotations aux amortissements) and 28 (Amortissements cumulés)
    const account681 = await tx.accountingAccount.findFirst({
      where: { tenantId, accountNumber: '681' },
    });
    const account28 = await tx.accountingAccount.findFirst({
      where: { tenantId, accountNumber: '28' },
    });

    if (!account681 || !account28) {
      throw new Error('Comptes comptables d\'amortissement (681, 28) non configurés');
    }

    // 4. Find Journal OD
    const journal = await tx.accountingJournal.findFirst({
      where: { tenantId, code: 'OD' },
    });
    if (!journal) throw new Error('Journal OD non configuré');

    // 5. Find/Create Period
    const periodName = `${year}`;
    let period = await tx.accountingPeriod.findFirst({
      where: { tenantId, name: periodName },
    });
    if (!period) {
      period = await tx.accountingPeriod.create({
        data: {
          tenantId,
          name: periodName,
          startDate: new Date(`${year}-01-01`),
          endDate: new Date(`${year}-12-31`),
        }
      });
    }

    // 6. Create Journal Entry
    const entryNumber = `AMO-${year}-${month.toString().padStart(2, '0')}`;
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber,
        date: new Date(year, month - 1, 1), // First day of month? Or last? We'll use first day for simplicity.
        description: `Dotation aux amortissements ${month}/${year}`,
        lines: {
          create: [
            { accountId: account681.id, debit: totalAmortization, credit: 0, description: `Dotation aux amortissements ${month}/${year}` },
            { accountId: account28.id, debit: 0, credit: totalAmortization, description: `Amortissements cumulés ${month}/${year}` },
          ]
        }
      },
      include: { lines: true }
    });

     // 7. Update accumulated amortization for each asset
     for (const asset of activeAssets) {
       const purchaseValueNum = Number(asset.purchaseValue ?? 0);
       const salvageValueNum = Number(asset.salvageValue ?? 0);
       const usefulLifeNum = Number(asset.usefulLife ?? 1);
       const depreciableBase = purchaseValueNum - salvageValueNum;
       const annualAmortization = depreciableBase / usefulLifeNum;
       const monthlyAmortization = annualAmortization / 12;

       await tx.asset.update({
         where: { id: asset.id },
         data: {
           accumulatedAmortization: {
             increment: monthlyAmortization
           }
         }
       });
     }

    return entry;
  });
}

/**
 * Initialize a standard Tunisian Chart of Accounts for a new tenant.
 */
export async function getGeneralLedger(
  tenantId: string,
  params: { startDate?: string; endDate?: string; accountId?: string; periodId?: string } = {}
): Promise<LedgerResult> {
  const { accountId, periodId } = params
  let start = parseDateParam(params.startDate)
  let end = parseDateParam(params.endDate)

  // Une période choisie borne la recherche à ses dates (si elle appartient au tenant)
  if (periodId) {
    const period = await prisma.accountingPeriod.findFirst({ where: { id: periodId, tenantId } })
    if (period) {
      start = period.startDate
      end = period.endDate
    }
  }
  // « Au 31/12 » inclut toute la journée du 31/12
  if (end && !periodId && /^\d{4}-\d{2}-\d{2}$/.test(params.endDate ?? '')) end = new Date(end.getTime() + 86_399_999)

  // JournalEntryLine n'a pas de colonne tenantId : le filtre passe par l'écriture parente.
  const where: Prisma.JournalEntryLineWhereInput = {
    journalEntry: {
      tenantId,
      ...(start || end ? { date: { ...(start && { gte: start }), ...(end && { lte: end }) } } : {}),
    },
    ...(accountId ? { accountId } : {}),
  }

  const lines = await prisma.journalEntryLine.findMany({
    where,
    include: { account: true, journalEntry: { include: { journal: true } } },
    orderBy: [{ account: { accountNumber: 'asc' } }, { journalEntry: { date: 'asc' } }],
  })

  return buildLedger(lines, { startDate: start?.toISOString() ?? null, endDate: end?.toISOString() ?? null })
}

