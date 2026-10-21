import { z } from 'zod'
import { prisma } from '@/lib/db'
import { AccountType, JournalType, Prisma } from '@prisma/client'
import { buildLedger, parseDateParam, type LedgerResult } from '@/lib/ledger'
import { computeVatDeclaration, monthRange, SALES_VAT_TYPES, EXCLUDED_SALE_STATUSES } from '@/lib/vat-declaration'
import { PURCHASE_INVOICE_TYPES } from '@/lib/firm-dashboard'
import { assertBelongsToTenant, assertAllBelongToTenant } from '@/lib/tenant-scope'

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
 * Initialize a standard Tunisian Chart of Accounts for a new tenant.
 */
export async function initChartOfAccounts(tenantId: string) {
  const standardAccounts = [
    { num: '101', name: 'Capital social', type: AccountType.EQUITY },
    { num: '221', name: 'Installations techniques', type: AccountType.ASSET },
    { num: '401', name: 'Fournisseurs d\'exploitation', type: AccountType.LIABILITY },
    { num: '411', name: 'Clients', type: AccountType.ASSET },
    { num: '512', name: 'Banque', type: AccountType.ASSET },
    { num: '531', name: 'Caisse', type: AccountType.ASSET },
    { num: '601', name: 'Achats de marchandises', type: AccountType.EXPENSE },
    { num: '701', name: 'Ventes de produits finis', type: AccountType.REVENUE },
  ]

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
    throw new Error('L\'écriture n\'est pas équilibrée (Débit != Crédit)')
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

export async function postInvoiceToAccounting(invoiceId: string, tenantId: string) {
  return prisma.$transaction(async (tx) => {
    // 1. Get invoice with details
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true, items: true }
    })

    if (!invoice || invoice.tenantId !== tenantId) throw new Error('Facture introuvable')
    if (invoice.accountingEntryId) throw new Error('Facture déjà comptabilisée')

    // 2. Find target accounts
    const acc411 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '411' } })
    const acc701 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '701' } })
    const acc445 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '445' } }) // TVA (Simplified)
    const acc543 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '543' } }) // Timbre (Simplified)

    if (!acc411 || !acc701) {
      throw new Error('Comptes comptables de base (411, 701) non configurés')
    }

    // 3. Find Sales Journal
    const journal = await tx.accountingJournal.findFirst({ where: { tenantId, code: 'VT' } })
    if (!journal) throw new Error('Journal des Ventes (VT) non configuré')

    // 4. Find/Create Period (simplified: current year)
    const currentYear = new Date().getFullYear().toString()
    let period = await tx.accountingPeriod.findFirst({ where: { tenantId, name: currentYear } })
    if (!period) {
      period = await tx.accountingPeriod.create({
        data: {
          tenantId,
          name: currentYear,
          startDate: new Date(`${currentYear}-01-01`),
          endDate: new Date(`${currentYear}-12-31`),
        }
      })
    }

    // 5. Prepare lines
    const lines = [
      { accountId: acc411.id, debit: Number(invoice.totalTTC), credit: 0, description: `Facture ${invoice.number}` },
      { accountId: acc701.id, debit: 0, credit: Number(invoice.subtotalHT), description: `Vente HT ${invoice.number}` },
    ]

    if (Number(invoice.totalVAT) > 0) {
      const vatAccId = acc445?.id || (await tx.accountingAccount.create({ data: { tenantId, accountNumber: '445', name: 'TVA Collectée', type: 'LIABILITY' } })).id
      lines.push({ accountId: vatAccId, debit: 0, credit: Number(invoice.totalVAT), description: `TVA sur ${invoice.number}` })
    }

    if (Number(invoice.timbreFiscal) > 0) {
      const stampAccId = acc543?.id || (await tx.accountingAccount.create({ data: { tenantId, accountNumber: '543', name: 'Timbre Fiscal', type: 'LIABILITY' } })).id
      lines.push({ accountId: stampAccId, debit: 0, credit: Number(invoice.timbreFiscal), description: `Timbre sur ${invoice.number}` })
    }

    // 6. Create Journal Entry
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber: `POST-${invoice.number}`,
        date: invoice.date,
        description: `Comptabilisation Facture ${invoice.number}`,
        lines: {
          createMany: { data: lines }
        }
      }
    })

    // 7. Link to invoice
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { accountingEntryId: entry.id }
    })

    return entry
  })
}

export async function postPaymentToAccounting(invoiceId: string, tenantId: string, method: 'CASH' | 'BANK' = 'BANK') {
  return prisma.$transaction(async (tx) => {
    // 1. Get invoice
    const invoice = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { client: true }
    })

    if (!invoice || invoice.tenantId !== tenantId) throw new Error('Facture introuvable')
    if (invoice.paymentEntryId) throw new Error('Règlement déjà comptabilisé')

    // 2. Find target accounts
    const acc411 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '411' } })
    const accTreasury = await tx.accountingAccount.findFirst({ 
      where: { tenantId, accountNumber: method === 'BANK' ? '512' : '531' } 
    })

    if (!acc411 || !accTreasury) {
      throw new Error(`Comptes comptables (411, ${method === 'BANK' ? '512' : '531'}) non configurés`)
    }

    // 3. Find Journal (BANK or CASH)
    const journalCode = method === 'BANK' ? 'BQ' : 'CS'
    const journal = await tx.accountingJournal.findFirst({ where: { tenantId, code: journalCode } })
    if (!journal) throw new Error(`Journal ${journalCode} non configuré`)

    // 4. Find/Create Period
    const currentYear = new Date().getFullYear().toString()
    let period = await tx.accountingPeriod.findFirst({ where: { tenantId, name: currentYear } })
    if (!period) {
      period = await tx.accountingPeriod.create({
        data: {
          tenantId,
          name: currentYear,
          startDate: new Date(`${currentYear}-01-01`),
          endDate: new Date(`${currentYear}-12-31`),
        }
      })
    }

    // 5. Create Journal Entry
    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber: `PAY-${invoice.number}`,
        date: new Date(),
        description: `Règlement Facture ${invoice.number}`,
        lines: {
          create: [
            { accountId: accTreasury.id, debit: Number(invoice.totalTTC), credit: 0, description: `Encaissement ${invoice.number}` },
            { accountId: acc411.id, debit: 0, credit: Number(invoice.totalTTC), description: `Solder ${invoice.number}` },
          ]
        }
      }
    })

    // 6. Update invoice status & link
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { 
        status: 'PAID',
        paymentEntryId: entry.id 
      }
    })

    return entry
  })
}

export async function postPurchaseToAccounting(purchaseOrderId: string, tenantId: string) {
  return prisma.$transaction(async (tx) => {
    // 1. Get purchase order
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { supplier: true, items: true }
    })

    if (!po || po.tenantId !== tenantId) throw new Error('Bon de commande fournisseur introuvable')
    if (po.accountingEntryId) throw new Error('Achat déjà comptabilisé')

    // 2. Find target accounts
    const acc401 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '401' } }) // Fournisseur
    const acc601 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '601' } }) // Achats
    const acc445 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '445' } }) // TVA Déductible (Simplified)

    if (!acc401 || !acc601) {
      throw new Error('Comptes comptables de base (401, 601) non configurés')
    }

    // 3. Find Purchase Journal
    const journal = await tx.accountingJournal.findFirst({ where: { tenantId, code: 'AC' } })
    if (!journal) throw new Error('Journal des Achats (AC) non configuré')

    // 4. Find/Create Period
    const currentYear = new Date().getFullYear().toString()
    let period = await tx.accountingPeriod.findFirst({ where: { tenantId, name: currentYear } })
    if (!period) {
      period = await tx.accountingPeriod.create({
        data: {
          tenantId,
          name: currentYear,
          startDate: new Date(`${currentYear}-01-01`),
          endDate: new Date(`${currentYear}-12-31`),
        }
      })
    }

    // 5. Prepare lines
    const lines = [
      { accountId: acc601.id, debit: Number(po.subtotal), credit: 0, description: `Achat ${po.number}` },
    ]

    if (Number(po.taxAmount) > 0) {
      const vatAccId = acc445?.id || (await tx.accountingAccount.create({ data: { tenantId, accountNumber: '445', name: 'TVA Déductible', type: 'ASSET' } })).id
      lines.push({ accountId: vatAccId, debit: Number(po.taxAmount), credit: 0, description: `TVA déductible sur ${po.number}` })
    }

    // Liability
    lines.push({ accountId: acc401.id, debit: 0, credit: Number(po.total), description: `Dette fournisseur ${po.number}` })

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

    // 7. Link to PO
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { accountingEntryId: entry.id }
    })

    return entry
  })
}

export async function postPayrollToAccounting(month: number, year: number, tenantId: string) {
  return prisma.$transaction(async (tx) => {
    // 1. Get all payslips for the period
    const payslips = await tx.paySlip.findMany({
      where: { tenantId, mois: month, annee: year, statut: 'PENDING' }
    })

    if (payslips.length === 0) throw new Error('Aucun bulletin de paie en attente trouvé pour cette période')
    if (payslips.some(p => p.accountingEntryId)) throw new Error('Certains bulletins sont déjà comptabilisés')

    // 2. Aggregate amounts
    const totals = payslips.reduce((acc, p) => ({
      gross: acc.gross + Number(p.brutGlobal),
      cnss: acc.cnss + Number(p.cnssSalaire),
      irpp: acc.irpp + Number(p.irpp),
      net: acc.net + Number(p.netAPayer),
    }), { gross: 0, cnss: 0, irpp: 0, net: 0 })

    // 3. Find target accounts
    const acc641 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '641' } }) // Rémunérations
    const acc431 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '431' } }) // CNSS
    const acc432 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '432' } }) // IRPP
    const acc421 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '421' } }) // Salaires dus

    if (!acc641 || !acc431 || !acc432 || !acc421) {
      throw new Error('Comptes comptables RH (641, 431, 432, 421) non configurés')
    }

    // 4. Find Journal OD
    const journal = await tx.accountingJournal.findFirst({ where: { tenantId, code: 'OD' } })
    if (!journal) throw new Error('Journal OD non configuré')

    // 5. Find/Create Period
    const periodName = `${year}`
    let period = await tx.accountingPeriod.findFirst({ where: { tenantId, name: periodName } })
    if (!period) {
      period = await tx.accountingPeriod.create({
        data: {
          tenantId,
          name: periodName,
          startDate: new Date(`${year}-01-01`),
          endDate: new Date(`${year}-12-31`),
        }
      })
    }

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
        journal: { code: 'VT' }
      },
      account: { accountNumber: { startsWith: '445' } } // simplified, should be 4457
    }
  })

  // 2. Get Deductible VAT (Achats)
  const deductibleLines = await prisma.journalEntryLine.findMany({
    where: {
      journalEntry: {
        tenantId,
        date: { gte: startDate, lte: endDate },
        journal: { code: 'AC' }
      },
      account: { accountNumber: { startsWith: '445' } } // simplified, should be 4456
    }
  })

  const collectedTotal = collectedLines.reduce((sum: number, line) => sum + Number(line.credit), 0)
  const deductibleTotal = deductibleLines.reduce((sum: number, line) => sum + Number(line.debit), 0)

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
    
    // 1. Find Journal OD
    const journal = await tx.accountingJournal.findFirst({ where: { tenantId, code: 'OD' } })
    if (!journal) throw new Error('Journal OD non configuré')

    // 2. Find Accounts
    const acc4457 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '445' } }) // Collected (simplified)
    const acc4455 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '447' } }) // Tax to pay
    const acc44567 = await tx.accountingAccount.findFirst({ where: { tenantId, accountNumber: '445' } }) // Credit (simplified)

    // 3. Find/Create Period
    const periodName = `${year}`
    let period = await tx.accountingPeriod.findFirst({ where: { tenantId, name: periodName } })
    if (!period) {
      period = await tx.accountingPeriod.create({
        data: {
          tenantId,
          name: periodName,
          startDate: new Date(`${year}-01-01`),
          endDate: new Date(`${year}-12-31`),
        }
      })
    }

    // 4. Create Entry
    const lines = [
      { accountId: acc4457!.id, debit: summary.collectedVAT, credit: 0, description: `Liquidation TVA Collectée ${month}/${year}` },
      { accountId: acc4457!.id, debit: 0, credit: summary.deductibleVAT, description: `Liquidation TVA Déductible ${month}/${year}` },
    ]

    if (summary.netVAT > 0) {
      lines.push({ accountId: acc4455!.id, debit: 0, credit: summary.netVAT, description: `TVA à décaisser ${month}/${year}` })
    } else if (summary.netVAT < 0) {
      lines.push({ accountId: acc44567!.id, debit: Math.abs(summary.netVAT), credit: 0, description: `Crédit de TVA ${month}/${year}` })
    }

    const entry = await tx.journalEntry.create({
      data: {
        tenantId,
        journalId: journal.id,
        periodId: period.id,
        entryNumber: `LIQ-TVA-${year}-${month.toString().padStart(2, '0')}`,
        date: new Date(year, month, 0), // Last day of month
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

