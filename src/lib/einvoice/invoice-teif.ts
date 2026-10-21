/**
 * Facture BelloSuite (Prisma, avec client/tenant/items) → données TEIF.
 * Module pur (sans node:*) : utilisable côté serveur et côté client.
 */
import type { TEIFData } from '@/lib/teif-generator'

/** Date ISO YYYY-MM-DD au calendrier de Tunis (évite le décalage UTC des dates à minuit). */
export function tunisIsoDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return ''
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function invoiceToTeifData(invoice: any, tenantOverride?: any): TEIFData {
  const tenant = tenantOverride ?? invoice.tenant ?? {}
  const client = invoice.client ?? {}
  return {
    invoiceNumber: invoice.number,
    type: invoice.type,
    issueDate: tunisIsoDate(invoice.date),
    dueDate: invoice.dueDate ? tunisIsoDate(invoice.dueDate) : undefined,
    tenant: {
      name: tenant.name || '',
      matriculeFiscal: tenant.matriculeFiscal || '',
      address: tenant.address || '',
      city: tenant.city || '',
      zipCode: tenant.zipCode || '',
      phone: tenant.phone || '',
    },
    client: {
      name: client.name || '',
      matriculeFiscal: client.matriculeFiscal || '',
      address: client.address || '',
      city: client.city || '',
      zipCode: client.zipCode || undefined,
    },
    items: invoice.items || [],
    totals: {
      subtotalHT: Number(invoice.subtotalHT || 0),
      totalFodec: Number(invoice.totalFodec || 0),
      totalVAT: Number(invoice.totalVAT || 0),
      timbreFiscal: Number(invoice.timbreFiscal ?? 1),
      totalTTC: Number(invoice.totalTTC || 0),
      vatSummary: invoice.vatSummary || {},
    },
  }
}
