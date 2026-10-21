import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { InvoiceStatus } from '@prisma/client'
import { assertBelongsToTenant, assertAllBelongToTenant } from '@/lib/tenant-scope'
import { resolveDeliveryWarehouseTx, postDeliveryNoteStockTx } from '@/services/delivery-notes'
import { computeDocumentTotals, DocumentTotalsError, defaultApplyStamp, hasZeroRatedLine, resolveApplyStamp } from '@/lib/document-totals'
import { nextDocumentNumberTx } from '@/lib/document-numbering'
import { r3, vatExemptionMention, type VatExemptionKind } from '@/lib/fiscal'
import { collectChain, findConversionConflict, resolveConversionTarget, type ChainDoc } from '@/lib/document-conversion'

// ─── Zod Schemas ────────────────────────────────────────────

export const invoiceItemSchema = z.object({
  productId: z.string().optional().nullable(),
  description: z.string().min(1, 'description requise'),
  unit: z.string().default('EA'),
  quantity: z.coerce.number().positive('quantité doit être positive'),
  unitPriceHT: z.coerce.number().min(0),
  discount: z.coerce.number().min(0).max(100).default(0),
  fodecApply: z.boolean().default(false),
  // Montants de ligne envoyés par le client : IGNORÉS (recalculés côté serveur)
  fodecAmount: z.coerce.number().optional(),
  vatRate: z.coerce.number().min(0).default(19),
  vatAmount: z.coerce.number().optional(),
  totalHT: z.coerce.number().optional(),
  totalTTC: z.coerce.number().optional(),
})

export const createInvoiceSchema = z.object({
  tenantId: z.string().min(1, 'tenantId requis'),
  clientId: z.string().min(1, 'client requis'),
  /** Ignoré : le numéro légal est attribué par le serveur à l'enregistrement. */
  number: z.string().optional().nullable(),
  type: z.string().default('INVOICE'),
  date: z.string().optional(),
  dueDate: z.string().optional().nullable(),
  /** Droit de timbre : défaut = factures uniquement */
  applyTimbre: z.boolean().optional(),
  timbreFiscal: z.coerce.number().min(0).optional(),
  /** Lignes à 0 % : EXEMPT | SUSPENSION | EXPORT (+ n° d'attestation pour la suspension) */
  vatExemption: z.enum(['EXEMPT', 'SUSPENSION', 'EXPORT']).optional().nullable(),
  vatExemptionRef: z.string().max(120).optional().nullable(),
  /** Avoir : facture d'origine */
  originalInvoiceId: z.string().optional().nullable(),
  warehouseId: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  items: z.array(invoiceItemSchema).min(1, 'au moins un article requis'),
})

export const invoiceFiltersSchema = z.object({
  tenantId: z.string().min(1),
  status: z.nativeEnum(InvoiceStatus).optional(),
  type: z.string().optional(),
  id: z.string().optional(),
})

export type CreateInvoiceData = z.infer<typeof createInvoiceSchema>
export type InvoiceFilters = z.infer<typeof invoiceFiltersSchema>

// ─── Service Functions ──────────────────────────────────────

export async function getInvoices(filters: InvoiceFilters) {
  const { tenantId, status, type, id } = filters

  // Single invoice by ID
  if (id) {
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { client: true, items: true, tenant: true },
    })
    if (!invoice || invoice.tenantId !== tenantId) {
      throw new BusinessError('Facture introuvable', 404)
    }
    return invoice
  }

  return prisma.invoice.findMany({
    where: {
      tenantId,
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    },
    include: {
      client: { select: { id: true, name: true, code: true, matriculeFiscal: true } },
      items: true,
      tenant: { select: { id: true, name: true, matriculeFiscal: true } },
    },
    orderBy: { date: 'desc' },
  })
}

/**
 * Création d'un document commercial (facture, devis, BC, BL, avoir) :
 *  - montants recalculés côté serveur (lib/document-totals, arrondi millime) — totaux client ignorés ;
 *  - numéro légal attribué dans la transaction (lib/document-numbering) ;
 *  - timbre fiscal par défaut sur les factures uniquement ;
 *  - lignes à 0 % : mention légale (exonération / suspension / export) ;
 *  - avoir : lié à sa facture d'origine (même client, montant ≤ reste non crédité) ;
 *  - BL : sortie de stock du dépôt choisi.
 */
export async function createInvoice(data: CreateInvoiceData, opts: { userId?: string | null } = {}) {
  const { tenantId, clientId, type, date, dueDate, notes } = data
  const docType = type || 'INVOICE'

  let computed: ReturnType<typeof computeDocumentTotals>
  try {
    computed = computeDocumentTotals(data.items, { applyStamp: resolveApplyStamp(docType, data) })
  } catch (e) {
    if (e instanceof DocumentTotalsError) throw new BusinessError(e.message, 400, { field: e.field })
    throw e
  }
  const { items, totals } = computed

  const vatExemption = hasZeroRatedLine(items) ? (data.vatExemption ?? 'EXEMPT') : null
  if (vatExemption === 'SUSPENSION' && !data.vatExemptionRef?.trim()) {
    throw new BusinessError('Vente en suspension de TVA : numéro de l\'attestation requis', 400, { field: 'vatExemptionRef' })
  }
  const vatMention = vatExemptionMention(vatExemption as VatExemptionKind | null, data.vatExemptionRef)

  // Les références liées doivent appartenir au tenant (anti-IDOR)
  await assertBelongsToTenant('client', clientId, tenantId)
  await assertAllBelongToTenant('product', items.map((i) => i.productId), tenantId)

  let originalInvoiceId: string | null = null
  if (docType === 'CREDIT_NOTE' && data.originalInvoiceId) {
    const orig = await prisma.invoice.findFirst({
      where: { id: data.originalInvoiceId, tenantId },
      select: { id: true, type: true, clientId: true, subtotalHT: true, totalFodec: true, totalVAT: true },
    })
    if (!orig || !INVOICE_TYPES.includes(orig.type)) throw new BusinessError('Facture d\'origine introuvable', 404, { field: 'originalInvoiceId' })
    if (orig.clientId !== clientId) throw new BusinessError('L\'avoir doit concerner le client de la facture d\'origine', 400, { field: 'clientId' })
    const previous = await prisma.invoice.findMany({
      where: { tenantId, type: 'CREDIT_NOTE', status: { notIn: [InvoiceStatus.CANCELLED, InvoiceStatus.REJECTED] }, originalInvoiceId: orig.id } as any, // TODO prisma generate
      select: { subtotalHT: true, totalFodec: true, totalVAT: true },
    })
    const credited = previous.reduce((s, p) => s + Number(p.subtotalHT) + Number(p.totalFodec) + Number(p.totalVAT), 0)
    const invoiced = Number(orig.subtotalHT) + Number(orig.totalFodec) + Number(orig.totalVAT)
    const thisOne = totals.subtotalHT + totals.totalFodec + totals.totalVAT
    if (r3(credited + thisOne) > r3(invoiced) + 0.0005) {
      throw new BusinessError(`Avoir supérieur au montant restant de la facture d'origine (${r3(invoiced - credited).toFixed(3)} DT)`, 400, { field: 'items' })
    }
    originalInvoiceId = orig.id
  }

  return prisma.$transaction(async (tx) => {
    // Pratique tunisienne : seul le bon de livraison (BL) sort la marchandise du stock.
    const delivery = docType === 'DELIVERY_NOTE'
      ? await resolveDeliveryWarehouseTx(tx, tenantId, data.warehouseId)
      : null
    const docDate = date ? new Date(date) : new Date()
    if (Number.isNaN(docDate.getTime())) throw new BusinessError('Date invalide', 400, { field: 'date' })
    const number = await nextDocumentNumberTx(tx, tenantId, docType, docDate)

    const invoice = await tx.invoice.create({
      data: {
        tenantId,
        clientId,
        number,
        type: docType,
        warehouseId: delivery?.warehouseId ?? null,
        status: InvoiceStatus.PENDING,
        date: docDate,
        dueDate: dueDate ? new Date(dueDate) : null,
        subtotalHT: totals.subtotalHT,
        totalFodec: totals.totalFodec,
        totalVAT: totals.totalVAT,
        timbreFiscal: totals.timbreFiscal,
        totalTTC: totals.totalTTC,
        vatSummary: totals.vatSummary as any,
        notes: notes ?? null,
        // TODO prisma generate : champs ajoutés par la migration 20261022000100
        ...({ vatExemption, vatMention, originalInvoiceId } as Record<string, unknown>),
        items: { create: items },
      } as any,
      include: { client: true, items: true },
    })

    if (delivery?.stockEnabled) {
      await postDeliveryNoteStockTx(tx, {
        tenantId,
        invoiceId: invoice.id,
        number,
        warehouseId: delivery.warehouseId,
        lines: items.map(i => ({ productId: i.productId, quantity: i.quantity })),
        userId: opts.userId ?? null,
      })
    }

    return invoice
  })
}

const INVOICE_TYPES = ['INVOICE', 'INVOICE_SERVICE', 'INVOICE_HONORARY']

export async function getPipelineData(tenantId: string) {
  const documents = await prisma.invoice.findMany({
    where: { tenantId, type: { in: ['QUOTE', 'ORDER'] } },
    include: { client: { select: { name: true } } },
    orderBy: { date: 'desc' },
  })

  const quotes = documents.filter((d) => d.type === 'QUOTE')
  const orders = documents.filter((d) => d.type === 'ORDER')
  // Documents déjà convertis = ceux qui ont un document issu d'eux (convertedFromId du fils)
  const children = documents.length
    ? await prisma.invoice.findMany({
        where: { tenantId, convertedFromId: { in: documents.map(d => d.id) }, status: { not: InvoiceStatus.CANCELLED } },
        select: { convertedFromId: true, type: true },
      })
    : []
  const convertedIds = new Set(children.map(c => c.convertedFromId))
  const invoicedIds = new Set(children.filter(c => c.type === 'INVOICE' || c.type === 'DELIVERY_NOTE').map(c => c.convertedFromId))

  const quoteStats = {
    total: quotes.length,
    draft: quotes.filter((d) => d.status === 'DRAFT').length,
    sent: quotes.filter((d) => d.status === 'SENT').length,
    confirmed: quotes.filter((d) => d.status === 'CONFIRMED').length,
    expired: quotes.filter((d) => d.dueDate && new Date(d.dueDate) < new Date()).length,
    converted: quotes.filter((d) => convertedIds.has(d.id)).length,
    totalValue: quotes.reduce((s, d) => s + Number(d.totalTTC), 0),
  }

  const orderStats = {
    total: orders.length,
    draft: orders.filter((d) => d.status === 'DRAFT').length,
    pending: orders.filter((d) => d.status === 'PENDING').length,
    confirmed: orders.filter((d) => d.status === 'CONFIRMED').length,
    invoiced: orders.filter((d) => invoicedIds.has(d.id)).length,
    totalValue: orders.reduce((s, d) => s + Number(d.totalTTC), 0),
  }

  const conversionRate = quoteStats.total > 0
    ? Math.round((quoteStats.confirmed / quoteStats.total) * 100)
    : 0

  const pipelineItems = documents.map((doc) => ({
    id: doc.id,
    number: doc.number,
    clientName: doc.client?.name || '—',
    date: doc.date.toISOString().split('T')[0],
    dueDate: doc.dueDate ? doc.dueDate.toISOString().split('T')[0] : null,
    totalTTC: Number(doc.totalTTC),
    status: doc.status,
    type: doc.type,
    daysUntilDue: doc.dueDate
      ? Math.floor((new Date(doc.dueDate).getTime() - Date.now()) / 86400000)
      : null,
  }))

  return { quoteStats, orderStats, conversionRate, pipelineItems }
}

/** Documents de la chaîne de conversion du source (ancêtres + descendants), requêtes itératives. */
async function loadConversionChain(tx: any, tenantId: string, source: ChainDoc): Promise<ChainDoc[]> {
  const select = { id: true, type: true, status: true, number: true, convertedFromId: true, originalInvoiceId: true }
  const all = new Map<string, ChainDoc>([[source.id, source]])
  // ancêtres
  let cur: ChainDoc | null = source
  for (let i = 0; i < 10 && cur?.convertedFromId; i++) {
    const parent: ChainDoc | null = await tx.invoice.findFirst({ where: { id: cur.convertedFromId, tenantId }, select })
    if (!parent || all.has(parent.id)) break
    all.set(parent.id, parent)
    cur = parent
  }
  // descendants (depuis tous les documents connus)
  let frontier = [...all.keys()]
  for (let i = 0; i < 10 && frontier.length; i++) {
    const children: ChainDoc[] = await tx.invoice.findMany({
      where: { tenantId, OR: [{ convertedFromId: { in: frontier } }, { originalInvoiceId: { in: frontier } }] },
      select,
    })
    frontier = []
    for (const c of children) if (!all.has(c.id)) { all.set(c.id, c); frontier.push(c.id) }
  }
  return collectChain(source.id, [...all.values()])
}

/**
 * Conversion d'un document : cible contrôlée (ALLOWED_CONVERSIONS), pas de double conversion
 * (verrou du source + contrôle de la chaîne), montants recalculés depuis les lignes
 * (timbre uniquement si la cible est une facture : jamais compté deux fois), numéro légal.
 */
export async function convertDocument(
  id: string,
  tenantId: string,
  targetType: string | null | undefined,
  opts: { warehouseId?: string | null; userId?: string | null } = {},
) {
  const source = await prisma.invoice.findFirst({
    where: { id, tenantId },
    include: { items: true, client: true },
  })
  if (!source) throw new BusinessError('Document source introuvable', 404)
  if (source.status === InvoiceStatus.CANCELLED) throw new BusinessError('Document annulé : conversion impossible', 409)

  const check = resolveConversionTarget(source.type, targetType)
  if (!check.ok) throw new BusinessError(check.message, 400, { code: 'CONVERSION_NOT_ALLOWED' })
  const target = check.target

  const { items, totals } = computeDocumentTotals(
    source.items.map(i => ({
      productId: i.productId, description: i.description, unit: i.unit,
      quantity: Number(i.quantity), unitPriceHT: Number(i.unitPriceHT), discount: Number(i.discount),
      vatRate: Number(i.vatRate), fodecApply: i.fodecApply,
    })),
    { applyStamp: defaultApplyStamp(target) },
  )

  return prisma.$transaction(async (tx) => {
    // Verrou du document source : deux conversions simultanées sont sérialisées
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${source.id} AND "tenantId" = ${tenantId} FOR UPDATE`
    const chain = await loadConversionChain(tx, tenantId, source as unknown as ChainDoc)
    const conflict = findConversionConflict(source as unknown as ChainDoc, target, chain)
    if (conflict) {
      throw new BusinessError(`Document déjà converti : ${conflict.number}`, 409, { code: 'ALREADY_CONVERTED', existingId: conflict.id, existingNumber: conflict.number })
    }

    const delivery = target === 'DELIVERY_NOTE'
      ? await resolveDeliveryWarehouseTx(tx, tenantId, opts.warehouseId)
      : null
    const now = new Date()
    const newNumber = await nextDocumentNumberTx(tx, tenantId, target, now)
    const src = source as typeof source & { vatExemption?: string | null; vatMention?: string | null }

    const newDoc = await tx.invoice.create({
      data: {
        tenantId,
        clientId: source.clientId,
        number: newNumber,
        type: target,
        warehouseId: delivery?.warehouseId ?? null,
        status: InvoiceStatus.PENDING,
        date: now,
        dueDate: target === 'CREDIT_NOTE' ? null : new Date(now.getTime() + 30 * 86400000),
        subtotalHT: totals.subtotalHT,
        totalFodec: totals.totalFodec,
        totalVAT: totals.totalVAT,
        timbreFiscal: totals.timbreFiscal,
        totalTTC: totals.totalTTC,
        vatSummary: totals.vatSummary as any,
        notes: target === 'CREDIT_NOTE'
          ? `Avoir sur facture ${source.number}`
          : `Converti depuis ${source.type} ${source.number}`,
        convertedFromId: source.id,
        convertedAt: now,
        // TODO prisma generate : champs ajoutés par la migration 20261022000100
        ...({
          originalInvoiceId: target === 'CREDIT_NOTE' ? source.id : null,
          vatExemption: src.vatExemption ?? null,
          vatMention: src.vatMention ?? null,
        } as Record<string, unknown>),
        items: { create: items },
      } as any,
    })

    if (delivery?.stockEnabled) {
      await postDeliveryNoteStockTx(tx, {
        tenantId,
        invoiceId: newDoc.id,
        number: newNumber,
        warehouseId: delivery.warehouseId,
        lines: items.map(i => ({ productId: i.productId, quantity: i.quantity })),
        userId: opts.userId ?? null,
      })
    }

    // Source marqué converti (devis / BC / BL) ; une facture reste dans son état de paiement
    if (!INVOICE_TYPES.includes(source.type)) {
      await tx.invoice.update({ where: { id: source.id }, data: { status: InvoiceStatus.CONFIRMED } })
    }

    return newDoc
  })
}
