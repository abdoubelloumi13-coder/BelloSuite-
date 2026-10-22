/**
 * Tableau de bord du cabinet : un instantané par dossier client (période déclarative précédente + mois en cours).
 */
import { prisma } from '@/lib/db'
import {
  clientAlerts, clientPriority, monthRange, periodFigures, previousPeriod,
  type ClientAlert, type PeriodFigures, type RegisterRow,
} from '@/lib/firm-logic'

export const PURCHASE_INVOICE_TYPES = ['INVOICE', 'SUPPLIER_INVOICE', 'PURCHASE_INVOICE']
export const MAX_FIRM_CLIENTS = 200

export type ClientSnapshot = {
  tenantId: string
  name: string
  matriculeFiscal: string | null
  accessOrigin: string
  since: string
  period: { year: number; month: number }
  previous: PeriodFigures
  current: PeriodFigures
  scansToReview: number
  deadline: string
  daysLeft: number
  alerts: ClientAlert[]
}

async function figuresFor(tenantId: string, year: number, month: number): Promise<PeriodFigures> {
  const range = monthRange(year, month)
  const [sales, purchases, rs] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, date: range },
      select: { type: true, status: true, subtotalHT: true, totalVAT: true, totalTTC: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, type: { in: PURCHASE_INVOICE_TYPES }, date: range },
      select: { status: true, subtotal: true, taxAmount: true, total: true },
    }),
    prisma.withholdingTax.findMany({
      // RS opérées par le tenant (à déclarer au TEJ) ; les RS subies sur ventes en sont exclues
      // TODO prisma generate : direction ajouté par la migration 20261022000100
      where: { tenantId, periodYear: year, periodMonth: month, direction: { not: 'SUFFERED' } } as any,
      select: { taxAmount: true, beneficiaryTin: true, beneficiaryAddress: true, beneficiaryEmail: true, beneficiaryPhone: true, paymentDate: true, tejStatus: true },
    }),
  ])
  return periodFigures(sales.map(s => ({ ...s, status: String(s.status) })), purchases, rs.map(r => ({ ...r, tejStatus: String(r.tejStatus) })))
}

export async function clientSnapshots(firmId: string, now: Date = new Date()): Promise<ClientSnapshot[]> {
  const accesses = await prisma.firmClientAccess.findMany({
    where: { firmId, status: 'ACTIVE' },
    select: { origin: true, createdAt: true, tenant: { select: { id: true, name: true, matriculeFiscal: true } } },
    orderBy: { createdAt: 'asc' },
    take: MAX_FIRM_CLIENTS,
  })
  const prev = previousPeriod(now)
  const cur = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  const out = await Promise.all(accesses.map(async (a) => {
    const t = a.tenant
    const [previous, current, scansToReview] = await Promise.all([
      figuresFor(t.id, prev.year, prev.month),
      figuresFor(t.id, cur.year, cur.month),
      prisma.scannedDocument.count({ where: { tenantId: t.id, reviewStatus: 'TO_REVIEW' } }),
    ])
    const { alerts, deadline, daysLeft } = clientAlerts({ matriculeFiscal: t.matriculeFiscal, previous, scansToReview, now })
    return {
      tenantId: t.id, name: t.name, matriculeFiscal: t.matriculeFiscal, accessOrigin: a.origin,
      since: a.createdAt.toISOString().slice(0, 10), period: prev, previous, current, scansToReview, deadline, daysLeft, alerts,
    }
  }))
  return out.sort((a, b) => clientPriority(b) - clientPriority(a) || a.name.localeCompare(b.name))
}

/** Lignes du registre ventes + achats d'un mois (export cabinet). */
export async function registerRows(tenantId: string, year: number, month: number): Promise<RegisterRow[]> {
  const range = monthRange(year, month)
  const [sales, purchases] = await Promise.all([
    prisma.invoice.findMany({
      where: { tenantId, date: range, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      select: { type: true, number: true, date: true, status: true, subtotalHT: true, totalFodec: true, totalVAT: true, timbreFiscal: true, totalTTC: true, rsAmount: true, client: { select: { name: true, matriculeFiscal: true } } },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, type: { in: PURCHASE_INVOICE_TYPES }, date: range, status: { not: 'CANCELLED' } },
      select: { number: true, supplierRef: true, date: true, status: true, subtotal: true, taxAmount: true, total: true, supplier: { select: { name: true, matriculeFiscal: true } } },
    }),
  ])
  const rows: RegisterRow[] = []
  for (const s of sales) {
    const sign = s.type === 'CREDIT_NOTE' ? -1 : 1
    rows.push({
      kind: 'VENTE', date: s.date, number: s.number, partyName: s.client?.name ?? '', partyMf: s.client?.matriculeFiscal ?? null,
      ht: sign * Number(s.subtotalHT), fodec: sign * Number(s.totalFodec), vat: sign * Number(s.totalVAT), stamp: Number(s.timbreFiscal),
      ttc: sign * Number(s.totalTTC), rs: Number(s.rsAmount), status: String(s.status),
    })
  }
  for (const p of purchases) {
    rows.push({
      kind: 'ACHAT', date: p.date, number: p.supplierRef || p.number, partyName: p.supplier?.name ?? '', partyMf: p.supplier?.matriculeFiscal ?? null,
      ht: Number(p.subtotal), vat: Number(p.taxAmount), ttc: Number(p.total), status: p.status,
    })
  }
  return rows
}
