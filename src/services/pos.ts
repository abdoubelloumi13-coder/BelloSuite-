import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { POSSessionStatus, POSOrderStatus, PaymentMethod, POSType } from '@prisma/client'
import { assertBelongsToTenant, assertAllBelongToTenant } from '@/lib/tenant-scope'
import { applyMovementTx, ensureDefaultWarehouseId } from '@/services/stock'
import { computePosTotals, settlePayments, readPosSettings, makeOrderNumber, buildZReport, round3, type PosSettings } from '@/lib/pos-logic'

// ─── Zod Schemas ────────────────────────────────────────────

export const openSessionSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  userName: z.string().min(1),
  openingCash: z.coerce.number().min(0, 'Le fond de caisse doit être positif ou nul'),
})

export const posOrderSchema = z.object({
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  /** Généré côté client (makeOrderNumber) ; à défaut généré par le serveur */
  orderNumber: z.string().trim().min(1).max(60).optional(),
  clientId: z.string().optional().nullable(),
  clientName: z.string().optional().nullable(),
  items: z.array(z.object({
    productId: z.string().optional().nullable(),
    productCode: z.string().optional().nullable(),
    description: z.string(),
    quantity: z.number().positive('Quantité > 0 requise'),
    unitPriceHT: z.number().min(0),
    vatRate: z.number().min(0).max(100).default(19),
    discount: z.number().min(0).max(100).default(0),
  })).min(1, 'Panier vide'),
  payments: z.array(z.object({
    method: z.nativeEnum(PaymentMethod),
    amount: z.number().positive(),
    reference: z.string().optional().nullable(),
  })).min(1, 'Au moins un paiement requis'),
  discountPercent: z.number().min(0).max(100).default(0),
  notes: z.string().optional().nullable(),
})

export type OpenSessionData = z.infer<typeof openSessionSchema>
export type POSOrderData = z.infer<typeof posOrderSchema>

// ─── Service Functions ──────────────────────────────────────

export async function getSessions(tenantId: string, opts: { status?: POSSessionStatus } = {}) {
  return prisma.pOSSession.findMany({
    where: { tenantId, ...(opts.status ? { status: opts.status } : {}) },
    include: { _count: { select: { orders: true } } },
    orderBy: { openedAt: 'desc' },
    take: 100,
  })
}

/** Session courante = la dernière session OUVERTE du tenant (jamais une session fermée). */
export async function getCurrentOpenSession(tenantId: string) {
  return prisma.pOSSession.findFirst({
    where: { tenantId, status: POSSessionStatus.OPEN },
    include: { _count: { select: { orders: true } } },
    orderBy: { openedAt: 'desc' },
  })
}

/** Réglages caisse du tenant (Tenant.settings.pos) — timbre désactivé par défaut. */
export async function getPosSettings(tenantId: string): Promise<PosSettings> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  return readPosSettings(t?.settings)
}

export async function updatePosSettings(tenantId: string, patch: Partial<PosSettings>): Promise<PosSettings> {
  const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  const settings = (t?.settings && typeof t.settings === 'object' && !Array.isArray(t.settings) ? t.settings : {}) as Record<string, unknown>
  const current = readPosSettings(settings)
  const next: PosSettings = {
    applyStamp: typeof patch.applyStamp === 'boolean' ? patch.applyStamp : current.applyStamp,
    stampAmount: patch.stampAmount !== undefined && Number.isFinite(Number(patch.stampAmount)) && Number(patch.stampAmount) >= 0 ? round3(Number(patch.stampAmount)) : current.stampAmount,
  }
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: { ...settings, pos: next } } })
  return next
}

export async function openSession(data: OpenSessionData) {
  // Une seule session ouverte par tenant : on reprend celle qui existe au lieu d'en créer une seconde
  const existing = await getCurrentOpenSession(data.tenantId)
  if (existing) return existing
  return prisma.$transaction(async (tx) => {
    const session = await tx.pOSSession.create({
      data: { ...data, status: POSSessionStatus.OPEN },
    })
    await tx.cashDrawer.upsert({
      where: { tenantId: data.tenantId },
      update: { balance: data.openingCash },
      create: { tenantId: data.tenantId, balance: data.openingCash },
    })
    return session
  })
}

export async function createPOSOrder(data: POSOrderData) {
  // Session de caisse, client et produits : uniquement ceux du tenant (anti-IDOR, y compris décrément de stock)
  await assertBelongsToTenant('pOSSession', data.sessionId, data.tenantId)
  await assertBelongsToTenant('client', data.clientId, data.tenantId)
  await assertAllBelongToTenant('product', data.items.map((i) => i.productId), data.tenantId)

  const session = await prisma.pOSSession.findFirst({ where: { id: data.sessionId, tenantId: data.tenantId }, select: { status: true } })
  if (!session || session.status !== POSSessionStatus.OPEN) throw new BusinessError('Session de caisse fermée : ouvrez une nouvelle session', 409)

  // Totaux recalculés côté serveur (remise sur HT puis TVA, timbre selon réglage et jamais sur panier vide)
  const settings = await getPosSettings(data.tenantId)
  const totals = computePosTotals(data.items, { discountPercent: data.discountPercent, applyStamp: settings.applyStamp, stampAmount: settings.stampAmount })
  const pay = settlePayments(totals.totalTTC, data.payments)
  if (!pay.isPaid) throw new BusinessError(`Paiement insuffisant : ${pay.paidAmount.toFixed(3)} DT reçus pour ${totals.totalTTC.toFixed(3)} DT dus`, 400)
  const orderNumber = data.orderNumber || makeOrderNumber()
  const methods = new Set(data.payments.map((p) => p.method))
  const paymentMethod = methods.size > 1 ? PaymentMethod.MIXED : data.payments[0].method

  return prisma.$transaction(async (tx) => {
    const order = await tx.pOSOrder.create({
      data: {
        tenantId: data.tenantId,
        sessionId: data.sessionId,
        orderNumber,
        clientId: data.clientId,
        clientName: data.clientName,
        subtotalHT: totals.subtotalHT,
        totalVAT: totals.totalVAT,
        timbreFiscal: totals.timbreFiscal,
        totalTTC: totals.totalTTC,
        paidAmount: pay.paidAmount,
        changeGiven: pay.changeGiven,
        paymentMethod,
        isPaid: pay.isPaid,
        status: POSOrderStatus.PAID,
        discountPercent: data.discountPercent,
        discountAmount: totals.discountAmount,
        notes: data.notes,
        items: {
          createMany: {
            data: data.items.map((item, i) => ({
              productId: item.productId ?? null,
              productCode: item.productCode ?? null,
              description: item.description,
              quantity: item.quantity,
              unitPriceHT: item.unitPriceHT,
              vatRate: item.vatRate,
              discount: item.discount,
              totalHT: totals.lines[i].totalHT,
              vatAmount: totals.lines[i].vatAmount,
              totalTTC: totals.lines[i].totalTTC,
            })),
          },
        },
        payments: {
          createMany: {
            data: data.payments.map(p => ({ method: p.method, amount: p.amount, reference: p.reference ?? null, tenantId: data.tenantId })),
          },
        },
      },
      include: { items: true, payments: true },
    })

    // Stock — via le service stock (mouvement = source de vérité, dépôt par défaut créé si aucun)
    const defaultWarehouseId = await ensureDefaultWarehouseId(data.tenantId, tx)
    for (const item of data.items) {
      if (item.productId && item.quantity > 0) {
        await applyMovementTx(tx, {
          tenantId: data.tenantId,
          productId: item.productId,
          warehouseId: defaultWarehouseId,
          type: 'EXIT',
          quantity: item.quantity,
          reference: order.id,
          reason: 'SALE',
          notes: `Vente POS #${orderNumber}`,
          sourceType: 'POS',
          sourceId: order.id,
          allowNegative: true,
        })
      }
    }

    // Tiroir-caisse : espèces nettes (reçues − monnaie rendue)
    const netCash = round3(pay.cashReceived - pay.changeGiven)
    if (netCash !== 0) {
      await tx.cashDrawer.upsert({
        where: { tenantId: data.tenantId },
        update: { balance: { increment: netCash } },
        create: { tenantId: data.tenantId, balance: netCash },
      })
    }

    return order
  })
}

/** Rapport Z d'une session (ouverte : provisoire « X » ; fermée : définitif). */
export async function getZReport(tenantId: string, sessionId: string) {
  const session = await prisma.pOSSession.findFirst({
    where: { id: sessionId, tenantId },
    include: { orders: { include: { items: true, payments: true }, orderBy: { createdAt: 'asc' } } },
  })
  if (!session) throw new BusinessError('Session non trouvée', 404)
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, matriculeFiscal: true, address: true, city: true } })
  const report = buildZReport(Number(session.openingCash), session.orders, session.status === POSSessionStatus.CLOSED && session.closingCash !== null ? Number(session.closingCash) : null)
  return {
    session: { id: session.id, userName: session.userName, status: session.status, openedAt: session.openedAt, closedAt: session.closedAt, notes: session.notes },
    tenant,
    firstTicket: session.orders[0]?.orderNumber ?? null,
    lastTicket: session.orders[session.orders.length - 1]?.orderNumber ?? null,
    report,
  }
}

/** Fermeture : attendu = fond + espèces nettes ; closingCash = montant compté (défaut : attendu). */
export async function closeSession(tenantId: string, sessionId: string, input: { countedCash?: number | null; notes?: string | null }) {
  const session = await prisma.pOSSession.findFirst({
    where: { id: sessionId, tenantId },
    include: { orders: { include: { items: true, payments: true } } },
  })
  if (!session) throw new BusinessError('Session non trouvée', 404)
  if (session.status === POSSessionStatus.CLOSED) throw new BusinessError('Session déjà fermée', 409)
  const pre = buildZReport(Number(session.openingCash), session.orders)
  const counted = input.countedCash === null || input.countedCash === undefined || !Number.isFinite(Number(input.countedCash)) ? pre.expectedCash : round3(Number(input.countedCash))
  const report = buildZReport(Number(session.openingCash), session.orders, counted)
  const updated = await prisma.$transaction(async (tx) => {
    const s = await tx.pOSSession.update({
      where: { id: sessionId },
      data: { closingCash: counted, status: POSSessionStatus.CLOSED, closedAt: new Date(), notes: input.notes ?? session.notes },
    })
    await tx.cashDrawer.upsert({ where: { tenantId }, update: { balance: counted }, create: { tenantId, balance: counted } })
    return s
  })
  return { session: updated, report }
}
