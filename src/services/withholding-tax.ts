import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { calculerRS, generateTEJId, isValidMatriculeFiscal, type BeneficiaryRegime, type ServiceType as RSServiceType } from '@/lib/retenue-source'
import { categorieFromMatricule } from '@/lib/tej-generator'
import { BeneficiaryType, ServiceType, TEJStatus, PaymentMethodType } from '@prisma/client'
import { assertBelongsToTenant, stripUnsafeUpdateFields } from '@/lib/tenant-scope'

// ─── Zod Schemas ────────────────────────────────────────────

export const createWithholdingTaxSchema = z.object({
  tenantId: z.string().min(1, 'tenantId requis'),
  beneficiaryName: z.string().trim().min(1, 'Nom ou raison sociale du bénéficiaire requis'),
  /** Matricule fiscal (7 chiffres + clé, jusqu'à 13 caractères : 1234567AAM000) ou CIN (8 chiffres) */
  beneficiaryTin: z.string().trim().max(20, 'Matricule fiscal trop long').optional().nullable()
    .refine(v => !v || isValidMatriculeFiscal(v) || /^\d{8}$/.test(v.replace(/\s/g, '')), {
      message: 'Matricule fiscal invalide : 7 chiffres + lettre clé (+ code TVA, catégorie, établissement), ex. 1234567AAM000 — ou CIN à 8 chiffres',
    }),
  beneficiaryType: z.nativeEnum(BeneficiaryType).default(BeneficiaryType.INDIVIDU),
  beneficiaryRegime: z.enum(['IS_20', 'IS_10', 'STANDARD', 'FORFAIT', 'HOTEL']).optional().nullable(),
  beneficiaryEmail: z.string().email('Adresse e-mail invalide').optional().nullable().or(z.literal('')),
  beneficiaryPhone: z.string().optional().nullable(),
  beneficiaryAddress: z.string().optional().nullable(),
  vatRate: z.coerce.number().min(0).max(100).optional().nullable(),
  serviceType: z.nativeEnum(ServiceType).default(ServiceType.PRESTATION_SERVICE),
  serviceDescription: z.string().optional().nullable(),
  /** Montant TTC payé : base de la retenue */
  grossAmount: z.coerce.number({ message: 'Montant TTC invalide' }).positive('Le montant TTC doit être positif'),
  periodMonth: z.coerce.number().int().min(1, 'Mois invalide').max(12, 'Mois invalide'),
  periodYear: z.coerce.number().int().min(2020, 'Année invalide'),
  /** Facture de VENTE liée : la retenue est alors SUBIE (opérée par le client), jamais déclarée au TEJ par le tenant */
  invoiceId: z.string().optional().nullable(),
  /** Facture fournisseur à l'origine d'une retenue opérée (déclarée au TEJ) */
  purchaseOrderId: z.string().optional().nullable(),
  paymentDate: z.string().optional().nullable()
    .refine(v => !v || !Number.isNaN(new Date(v).getTime()), { message: 'Date de paiement invalide' }),
  paymentMethod: z.nativeEnum(PaymentMethodType).optional().nullable(),
  paymentReference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
})

export type CreateWithholdingTaxData = z.infer<typeof createWithholdingTaxSchema>

// ─── Service Functions ──────────────────────────────────────

export async function getWithholdingTaxes(tenantId: string, filters: {
  periodYear?: number
  periodMonth?: number
  tejStatus?: TEJStatus
  direction?: 'DECLARED' | 'SUFFERED'
}) {
  return prisma.withholdingTax.findMany({
    where: {
      tenantId,
      // TODO prisma generate : direction ajouté par la migration 20261022000100
      ...(filters.direction ? ({ direction: filters.direction } as Record<string, unknown>) : {}),
      ...(filters.periodYear ? { periodYear: filters.periodYear } : {}),
      ...(filters.periodMonth ? { periodMonth: filters.periodMonth } : {}),
      ...(filters.tejStatus && filters.tejStatus !== 'TOUT' as any ? { tejStatus: filters.tejStatus } : {}),
    },
    include: {
      invoice: { select: { number: true, date: true, totalTTC: true } },
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function createWithholdingTax(data: CreateWithholdingTaxData) {
  const { tenantId, grossAmount, serviceType, beneficiaryType, periodYear, periodMonth } = data
  await assertBelongsToTenant('invoice', data.invoiceId, tenantId)
  await assertBelongsToTenant('purchaseOrder', data.purchaseOrderId, tenantId)
  // Une RS rattachée à une facture de vente est subie (opérée par le client) : hors TEJ du tenant
  const direction = data.invoiceId ? 'SUFFERED' : 'DECLARED'

  // 1. Calculate RS based on Tunisian rules
  const calc = calculerRS({
    montantBrut: grossAmount,
    serviceType: serviceType as any,
    beneficiaryType: beneficiaryType as any,
    regime: (data.beneficiaryRegime as any) ?? null,
  })
  if (calc.taux === 0) throw new BusinessError(`Pas de retenue à la source : ${calc.label}`, 400, { field: 'grossAmount' })

  return prisma.$transaction(async (tx) => {
    // 2. Référence TEJ séquentielle de la période (RS déclarées seulement)
    let tejId: string | null = null
    if (direction === 'DECLARED') {
      const count = await tx.withholdingTax.count({
        // TODO prisma generate : direction ajouté par la migration 20261022000100
        where: { tenantId, periodYear, periodMonth, direction: 'DECLARED' } as any,
      })
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { matriculeFiscal: true } })
      tejId = generateTEJId(tenant?.matriculeFiscal || 'UNKNOWN', periodYear, periodMonth, count + 1)
    }

    // 3. Create the record
    return tx.withholdingTax.create({
      data: {
        ...data,
        beneficiaryTin: data.beneficiaryTin ? data.beneficiaryTin.toUpperCase().replace(/[\s/.\-]/g, '') : null,
        beneficiaryEmail: data.beneficiaryEmail || null,
        rate: calc.taux,
        taxAmount: calc.montantRS,
        netAmount: calc.montantNet,
        teeJAmount: calc.montantTEEJ,
        tejId,
        tejStatus: TEJStatus.DRAFT,
        direction,
        paymentDate: data.paymentDate ? new Date(data.paymentDate) : null,
      } as any, // TODO prisma generate : direction / purchaseOrderId
      include: { invoice: true },
    })
  })
}

/**
 * RS SUBIE sur une facture de VENTE : le client (débiteur) retient l'impôt au paiement et le
 * déclare lui-même au TEJ ; le tenant (bénéficiaire du paiement) enregistre une créance sur l'État
 * (4341) et attend le certificat de retenue. Taux selon le régime du TENANT (bénéficiaire).
 */
export async function generateSufferedFromInvoice(
  invoiceId: string,
  tenantId: string,
  opts: { serviceType?: string | null; beneficiaryRegime?: string | null; periodYear?: number; periodMonth?: number; notes?: string | null; grossAmount?: number | null } = {},
) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { client: true, tenant: { select: { name: true, matriculeFiscal: true } } },
  })
  if (!invoice) throw new BusinessError('Facture introuvable', 404)
  if (!['INVOICE', 'INVOICE_SERVICE', 'INVOICE_HONORARY'].includes(invoice.type)) {
    throw new BusinessError('Une retenue à la source ne concerne qu\'une facture de vente', 400)
  }
  const existing = await prisma.withholdingTax.findFirst({ where: { invoiceId, tenantId }, select: { id: true, tejStatus: true } })
  if (existing) throw new BusinessError('Une retenue à la source existe déjà pour cette facture', 409, { existingId: existing.id, existingStatus: existing.tejStatus })

  const serviceType = (opts.serviceType as RSServiceType) || (invoice.type === 'INVOICE_HONORARY' ? 'HONORAIRES' : 'PRESTATION_SERVICE')
  // Le bénéficiaire du paiement est le tenant : sa catégorie (PM / PP) détermine le taux
  const beneficiaryType = invoice.tenant?.matriculeFiscal && categorieFromMatricule(invoice.tenant.matriculeFiscal, 'PM') === 'PP'
    ? BeneficiaryType.INDIVIDU : BeneficiaryType.SOCIETE
  const grossAmount = opts.grossAmount && opts.grossAmount > 0 ? opts.grossAmount : Number(invoice.totalTTC)
  const calc = calculerRS({ montantBrut: grossAmount, serviceType, beneficiaryType, regime: (opts.beneficiaryRegime as BeneficiaryRegime) ?? null })
  if (calc.taux === 0) throw new BusinessError(`Pas de retenue à la source : ${calc.label}`, 400)

  const client = invoice.client
  return prisma.withholdingTax.create({
    data: {
      tenantId,
      invoiceId: invoice.id,
      direction: 'SUFFERED',
      // Contrepartie : le client qui a opéré la retenue (agent payeur)
      beneficiaryTin: client?.matriculeFiscal ?? null,
      beneficiaryName: client?.name ?? 'Client',
      beneficiaryAddress: [client?.address, client?.city].filter(Boolean).join(', ') || null,
      beneficiaryType,
      beneficiaryRegime: opts.beneficiaryRegime ?? null,
      beneficiaryEmail: client?.email ?? null,
      beneficiaryPhone: client?.phone ?? null,
      serviceType: serviceType as ServiceType,
      serviceDescription: `RS subie — retenue opérée par ${client?.name ?? 'le client'} sur la facture ${invoice.number}`,
      grossAmount,
      rate: calc.taux,
      taxAmount: calc.montantRS,
      netAmount: calc.montantNet,
      teeJAmount: calc.montantNet,
      periodYear: Number(opts.periodYear) || invoice.date.getUTCFullYear(),
      periodMonth: Number(opts.periodMonth) || invoice.date.getUTCMonth() + 1,
      tejStatus: TEJStatus.DRAFT,
      paymentDate: invoice.dueDate ?? invoice.date,
      notes: opts.notes ?? `Retenue subie — certificat de retenue à réclamer au client (facture ${invoice.number})`,
    } as any, // TODO prisma generate : direction
  })
}

/** @deprecated conservé pour la route from-invoice : une facture de vente donne une RS SUBIE. */
export async function generateFromInvoice(invoiceId: string, tenantId: string) {
  return generateSufferedFromInvoice(invoiceId, tenantId)
}

export async function getWithholdingTaxById(id: string, tenantId: string) {
  const record = await prisma.withholdingTax.findUnique({
    where: { id },
    include: { invoice: { include: { client: true } }, tenant: true },
  })
  if (!record || record.tenantId !== tenantId) {
    throw new BusinessError('Certificat de retenue introuvable', 404)
  }
  return record
}

export async function updateWithholdingTax(id: string, tenantId: string, rawData: any) {
  const existing = await getWithholdingTaxById(id, tenantId)
  // Pas de changement de tenant/id ni d'écriture imbriquée ; facture liée = facture du tenant
  const data: any = stripUnsafeUpdateFields(rawData ?? {})
  delete data.direction // le sens (subie / opérée) découle de la pièce liée, pas d'une saisie
  await assertBelongsToTenant('invoice', data.invoiceId, tenantId)
  if (data.invoiceId) data.direction = 'SUFFERED'
  if (typeof data.beneficiaryTin === 'string' && data.beneficiaryTin.trim()) {
    const tin = data.beneficiaryTin.trim()
    if (!isValidMatriculeFiscal(tin) && !/^\d{8}$/.test(tin.replace(/\s/g, ''))) {
      throw new BusinessError('Matricule fiscal invalide : 7 chiffres + lettre clé (+ code TVA, catégorie, établissement), ex. 1234567AAM000 — ou CIN à 8 chiffres', 400, { field: 'beneficiaryTin' })
    }
    data.beneficiaryTin = tin.toUpperCase().replace(/[\s/.\-]/g, '')
  }

  // Recalculate if critical fields change
  let calc = {
    taux: Number(existing.rate),
    montantRS: Number(existing.taxAmount),
    montantNet: Number(existing.netAmount),
    montantTEEJ: Number(existing.teeJAmount),
  }

  if (data.grossAmount !== undefined || data.serviceType !== undefined || data.beneficiaryType !== undefined || data.beneficiaryRegime !== undefined) {
    const res = calculerRS({
      montantBrut: data.grossAmount ?? Number(existing.grossAmount),
      serviceType: data.serviceType ?? (existing.serviceType as any),
      beneficiaryType: data.beneficiaryType ?? (existing.beneficiaryType as any),
      regime: (data.beneficiaryRegime ?? existing.beneficiaryRegime) as any,
    })
    calc = {
      taux: res.taux,
      montantRS: res.montantRS,
      montantNet: res.montantNet,
      montantTEEJ: res.montantTEEJ,
    }
  }

  return prisma.withholdingTax.update({
    where: { id },
    data: {
      ...data,
      rate: calc.taux,
      taxAmount: calc.montantRS,
      netAmount: calc.montantNet,
      teeJAmount: calc.montantTEEJ,
      paymentDate: data.paymentDate ? new Date(data.paymentDate) : undefined,
    },
    include: { invoice: { include: { client: true } } },
  })
}

export async function deleteWithholdingTax(id: string, tenantId: string) {
  const existing = await getWithholdingTaxById(id, tenantId)
  
  if (existing.tejStatus === TEJStatus.ACCEPTED) {
    throw new BusinessError('Impossible de supprimer un certificat déjà validé', 400)
  }

  return prisma.withholdingTax.delete({ where: { id } })
}
