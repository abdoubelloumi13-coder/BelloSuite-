/**
 * Service du module stock.
 *
 * RÈGLE D'OR : toute variation de quantité passe par `applyMovementTx` (mouvement = source de vérité),
 * à l'intérieur d'une transaction Prisma. Cette fonction :
 *   1. verrouille la ligne produit (SELECT … FOR UPDATE) pour sérialiser les mouvements concurrents ;
 *   2. contrôle le stock négatif (sauf paramètre « autoriser le stock négatif ») ;
 *   3. recalcule le CMUP sur les entrées ;
 *   4. met à jour Product.currentStock, ProductWarehouse.stock et crée le StockMovement
 *      (avec solde et coût après mouvement).
 */
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { Prisma, StockMovementType, InventoryStatus, TransferStatus } from '@prisma/client'
import { assertBelongsToTenant, assertAllBelongToTenant } from '@/lib/tenant-scope'
import {
  movementDelta, computeCmup, checkAvailability, planTransfer, inventoryAdjustments,
  valuationCost, round3, formatReference, isLowStock, suggestedOrderQty, alertThreshold, stockValue,
} from '@/lib/stock-logic'

type Tx = Prisma.TransactionClient
type Db = typeof prisma | Tx

// ─── Zod Schemas ────────────────────────────────────────────

const optStr = z.string().trim().max(500).optional().nullable()

export const createWarehouseSchema = z.object({
  tenantId: z.string().min(1),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  address: optStr,
  manager: optStr,
  phone: optStr,
  isDefault: z.boolean().default(false),
})
export type CreateWarehouseData = z.infer<typeof createWarehouseSchema>

export const updateWarehouseSchema = z.object({
  code: z.string().trim().min(1).max(30).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  address: optStr,
  manager: optStr,
  phone: optStr,
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
})

/** Mouvements manuels autorisés depuis l'API (les transferts passent par /transfers). */
export const createStockMovementSchema = z.object({
  tenantId: z.string().min(1),
  productId: z.string().min(1),
  warehouseId: z.string().optional().nullable(),
  type: z.enum(['ENTRY', 'EXIT', 'ADJUSTMENT']),
  quantity: z.coerce.number().refine(n => Number.isFinite(n) && n !== 0, 'Quantité non nulle requise'),
  unitPrice: z.coerce.number().min(0).optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
  reason: z.string().trim().max(100).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
})
export type CreateStockMovementData = z.infer<typeof createStockMovementSchema>

const transferLineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  notes: z.string().trim().max(500).optional().nullable(),
})
export const transferSchema = z.object({
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
  items: z.array(transferLineSchema).min(1).max(500),
})
export type TransferData = z.infer<typeof transferSchema>

export const createInventorySchema = z.object({
  warehouseId: z.string().min(1),
  scope: z.enum(['FULL', 'CATEGORY']).default('FULL'),
  category: z.string().trim().max(120).optional().nullable(),
  date: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
})

export const inventoryCountsSchema = z.object({
  counts: z.array(z.object({
    itemId: z.string().min(1),
    actualQty: z.coerce.number().min(0).nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })).max(5000),
})

// ─── Paramètres ─────────────────────────────────────────────

export interface StockSettings {
  allowNegativeStock: boolean
}

export function readStockSettings(settings: unknown): StockSettings {
  const s = (settings && typeof settings === 'object' ? (settings as Record<string, unknown>).stock : null) as Record<string, unknown> | null
  return { allowNegativeStock: Boolean(s?.allowNegativeStock) }
}

export async function getStockSettings(tenantId: string, db: Db = prisma): Promise<StockSettings> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  return readStockSettings(t?.settings)
}

export async function updateStockSettings(tenantId: string, patch: Partial<StockSettings>) {
  return prisma.$transaction(async (tx) => {
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
    const settings = (t?.settings && typeof t.settings === 'object' ? t.settings : {}) as Record<string, unknown>
    const current = readStockSettings(settings)
    const next = { ...current, ...patch }
    await tx.tenant.update({ where: { id: tenantId }, data: { settings: { ...settings, stock: next } as Prisma.InputJsonValue } })
    return next
  })
}

// ─── Mouvement unitaire (source de vérité) ──────────────────

export interface MovementInput {
  tenantId: string
  productId: string
  warehouseId: string | null
  type: StockMovementType
  /** ENTRY/EXIT : positive. ADJUSTMENT/TRANSFER : signée. */
  quantity: number
  /** Coût unitaire (entrées) ; à défaut le CMUP courant est enregistré. */
  unitCost?: number | null
  reference?: string | null
  reason?: string | null
  notes?: string | null
  sourceType?: string | null
  sourceId?: string | null
  createdById?: string | null
  allowNegative: boolean
}

export async function applyMovementTx(tx: Tx, input: MovementInput) {
  const { tenantId, productId, warehouseId, type } = input
  const delta = movementDelta(type as 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'TRANSFER', input.quantity)
  if (delta === 0) throw new BusinessError('Quantité non nulle requise', 400)

  // 1. Verrou ligne produit (sérialise les mouvements concurrents sur ce produit)
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Product" WHERE id = ${productId} AND "tenantId" = ${tenantId} FOR UPDATE`
  if (!locked.length) throw new BusinessError('Produit introuvable', 404)

  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { id: true, code: true, currentStock: true, averageCost: true, purchasePrice: true },
  })
  if (!product) throw new BusinessError('Produit introuvable', 404)

  // 2. Disponibilité (par dépôt si renseigné, sinon globale)
  let available = Number(product.currentStock)
  if (warehouseId) {
    const pw = await tx.productWarehouse.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { stock: true },
    })
    available = Number(pw?.stock ?? 0)
  }
  const check = checkAvailability(available, delta, input.allowNegative)
  if (!check.ok) {
    throw new BusinessError(`Stock insuffisant pour ${product.code} : disponible ${round3(available)}, demandé ${round3(-delta)}`, 409)
  }

  // 3. CMUP (uniquement sur les entrées valorisées)
  const currentAvg = valuationCost(Number(product.averageCost), Number(product.purchasePrice))
  const hasCost = input.unitCost !== null && input.unitCost !== undefined && Number.isFinite(Number(input.unitCost))
  const newAvg = type === StockMovementType.ENTRY && hasCost
    ? computeCmup(Math.max(Number(product.currentStock), 0), currentAvg, delta, Number(input.unitCost))
    : currentAvg

  // 4. Écritures
  await tx.product.update({
    where: { id: productId },
    data: { currentStock: { increment: delta }, averageCost: newAvg },
  })
  if (warehouseId) {
    await tx.productWarehouse.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      update: { stock: { increment: delta } },
      create: { productId, warehouseId, stock: delta },
    })
  }
  return tx.stockMovement.create({
    data: {
      tenantId,
      productId,
      warehouseId: warehouseId || null,
      type,
      quantity: input.quantity,
      unitPrice: hasCost ? Number(input.unitCost) : currentAvg,
      reference: input.reference || null,
      reason: input.reason || null,
      notes: input.notes || null,
      sourceType: input.sourceType || 'MANUAL',
      sourceId: input.sourceId || null,
      createdById: input.createdById || null,
      balanceAfter: check.resulting,
      costAfter: newAvg,
    },
  })
}

/** Dépôt par défaut actif du tenant (ou le premier actif), null s'il n'y en a pas. */
export async function getDefaultWarehouseId(tenantId: string, db: Db = prisma): Promise<string | null> {
  const w = await db.warehouse.findFirst({
    where: { tenantId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  })
  return w?.id ?? null
}

/** Code et nom du dépôt créé automatiquement quand le tenant n'en a aucun. */
export const DEFAULT_WAREHOUSE_CODE = 'DEP-PRINCIPAL'
export const DEFAULT_WAREHOUSE_NAME = 'Dépôt principal'

/**
 * Dépôt par défaut du tenant ; si le tenant n'a AUCUN dépôt (actif ou archivé), crée un « Dépôt principal »
 * (isDefault) pour que produits, mouvements, inventaires et POS ne restent pas bloqués.
 * Idempotent : la contrainte unique (tenantId, code) protège des créations concurrentes.
 */
export async function ensureDefaultWarehouseId(tenantId: string, db: Db = prisma): Promise<string | null> {
  const existing = await getDefaultWarehouseId(tenantId, db)
  if (existing) return existing
  const any = await db.warehouse.count({ where: { tenantId } })
  if (any > 0) return null // seulement des dépôts archivés : on ne recrée pas dans le dos de l'utilisateur
  try {
    const w = await db.warehouse.create({
      data: { tenantId, code: DEFAULT_WAREHOUSE_CODE, name: DEFAULT_WAREHOUSE_NAME, isDefault: true, isActive: true },
      select: { id: true },
    })
    return w.id
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return getDefaultWarehouseId(tenantId, db)
    throw err
  }
}

async function assertActiveWarehouse(tenantId: string, warehouseId: string, db: Db = prisma) {
  const w = await db.warehouse.findFirst({ where: { id: warehouseId, tenantId }, select: { isActive: true } })
  if (!w) throw new BusinessError('Référence invalide (warehouse)', 400)
  if (!w.isActive) throw new BusinessError('Ce dépôt est archivé', 409)
}

/** Mouvement manuel (entrée, sortie, ajustement). */
export async function createStockMovement(data: CreateStockMovementData, userId?: string | null) {
  const { tenantId, productId } = data
  await assertBelongsToTenant('product', productId, tenantId)
  const warehouseId = data.warehouseId || (await ensureDefaultWarehouseId(tenantId))
  if (!warehouseId) throw new BusinessError('Aucun dépôt actif : réactivez ou créez un dépôt', 400)
  await assertActiveWarehouse(tenantId, warehouseId)
  const settings = await getStockSettings(tenantId)

  return prisma.$transaction((tx) => applyMovementTx(tx, {
    tenantId,
    productId,
    warehouseId,
    type: data.type as StockMovementType,
    quantity: data.type === 'ADJUSTMENT' ? data.quantity : Math.abs(data.quantity),
    unitCost: data.type === 'ENTRY' ? (data.unitPrice ?? null) : null,
    reference: data.reference,
    reason: data.reason,
    notes: data.notes,
    sourceType: 'MANUAL',
    createdById: userId ?? null,
    allowNegative: settings.allowNegativeStock,
  }))
}

// ─── Dépôts ─────────────────────────────────────────────────

export async function getWarehouses(tenantId: string, opts: { includeArchived?: boolean } = {}) {
  const warehouses = await prisma.warehouse.findMany({
    where: { tenantId, ...(opts.includeArchived ? {} : { isActive: true }) },
    include: {
      productStock: {
        include: { product: { select: { id: true, name: true, code: true, averageCost: true, purchasePrice: true, minStock: true } } },
      },
    },
    orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { name: 'asc' }],
  })

  return warehouses.map(({ productStock, ...w }) => ({
    ...w,
    totalProducts: productStock.filter(pw => Number(pw.stock) !== 0).length,
    totalQty: round3(productStock.reduce((s, pw) => s + Number(pw.stock), 0)),
    totalValue: round3(productStock.reduce((s, pw) => s + stockValue(Number(pw.stock), valuationCost(Number(pw.product.averageCost), Number(pw.product.purchasePrice))), 0)),
    lowStockCount: productStock.filter(pw => isLowStock(Number(pw.stock), pw.minStock !== null ? Number(pw.minStock) : 0)).length,
  }))
}

export async function createWarehouse(data: CreateWarehouseData) {
  const { tenantId, isDefault } = data
  const exists = await prisma.warehouse.findFirst({ where: { tenantId, code: data.code }, select: { id: true } })
  if (exists) throw new BusinessError('Code dépôt déjà utilisé', 409)
  return prisma.$transaction(async (tx) => {
    const count = await tx.warehouse.count({ where: { tenantId, isActive: true } })
    const makeDefault = isDefault || count === 0
    if (makeDefault) await tx.warehouse.updateMany({ where: { tenantId, isDefault: true }, data: { isDefault: false } })
    return tx.warehouse.create({ data: { ...data, isDefault: makeDefault } })
  })
}

export async function updateWarehouse(tenantId: string, id: string, data: z.infer<typeof updateWarehouseSchema>) {
  const wh = await prisma.warehouse.findFirst({ where: { id, tenantId } })
  if (!wh) throw new BusinessError('Dépôt introuvable', 404)
  if (data.code && data.code !== wh.code) {
    const dup = await prisma.warehouse.findFirst({ where: { tenantId, code: data.code, NOT: { id } }, select: { id: true } })
    if (dup) throw new BusinessError('Code dépôt déjà utilisé', 409)
  }
  return prisma.$transaction(async (tx) => {
    const patch: Prisma.WarehouseUpdateInput = { ...data }
    if (data.isActive === false) patch.isDefault = false
    if (data.isDefault === true && data.isActive !== false) {
      if (!wh.isActive && data.isActive !== true) throw new BusinessError('Un dépôt archivé ne peut pas être le dépôt par défaut', 409)
      await tx.warehouse.updateMany({ where: { tenantId, isDefault: true, NOT: { id } }, data: { isDefault: false } })
    }
    return tx.warehouse.update({ where: { id }, data: patch })
  })
}

/** Suppression uniquement d'un dépôt vierge ; sinon 409 → archiver. */
export async function deleteWarehouse(tenantId: string, id: string) {
  const wh = await prisma.warehouse.findFirst({ where: { id, tenantId }, select: { id: true } })
  if (!wh) throw new BusinessError('Dépôt introuvable', 404)
  const [withStock, movements, transfers, inventories] = await Promise.all([
    prisma.productWarehouse.count({ where: { warehouseId: id, NOT: { stock: 0 } } }),
    prisma.stockMovement.count({ where: { tenantId, warehouseId: id } }),
    prisma.stockTransfer.count({ where: { tenantId, OR: [{ fromWarehouseId: id }, { toWarehouseId: id }] } }),
    prisma.inventory.count({ where: { tenantId, warehouseId: id } }),
  ])
  if (withStock > 0) throw new BusinessError('WAREHOUSE_HAS_STOCK', 409)
  if (movements + transfers + inventories > 0) throw new BusinessError('WAREHOUSE_HAS_HISTORY', 409)
  await prisma.$transaction([
    prisma.productWarehouse.deleteMany({ where: { warehouseId: id } }),
    prisma.warehouse.delete({ where: { id } }),
  ])
  return { success: true }
}

// ─── Références ─────────────────────────────────────────────

async function nextReference(tx: Tx, kind: 'transfer' | 'inventory', tenantId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = kind === 'transfer' ? 'TRF' : 'INV'
  const like = `${prefix}-${year}-`
  const count = kind === 'transfer'
    ? await tx.stockTransfer.count({ where: { tenantId, reference: { startsWith: like } } })
    : await tx.inventory.count({ where: { tenantId, reference: { startsWith: like } } })
  for (let seq = count + 1; seq < count + 50; seq++) {
    const ref = formatReference(prefix, year, seq)
    const taken = kind === 'transfer'
      ? await tx.stockTransfer.count({ where: { tenantId, reference: ref } })
      : await tx.inventory.count({ where: { tenantId, reference: ref } })
    if (!taken) return ref
  }
  return `${like}${Date.now()}`
}

// ─── Transferts ─────────────────────────────────────────────

export async function createTransfer(tenantId: string, data: TransferData) {
  if (data.fromWarehouseId === data.toWarehouseId) throw new BusinessError('Dépôts source et destination identiques', 400)
  await assertActiveWarehouse(tenantId, data.fromWarehouseId)
  await assertActiveWarehouse(tenantId, data.toWarehouseId)
  await assertAllBelongToTenant('product', data.items.map(i => i.productId), tenantId)
  return prisma.$transaction(async (tx) => {
    const reference = await nextReference(tx, 'transfer', tenantId)
    return tx.stockTransfer.create({
      data: {
        tenantId,
        reference,
        date: data.date ?? new Date(),
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        status: TransferStatus.DRAFT,
        notes: data.notes || null,
        items: { create: data.items.map(i => ({ productId: i.productId, quantity: i.quantity, notes: i.notes || null })) },
      },
      include: { items: true },
    })
  })
}

export async function updateTransfer(tenantId: string, id: string, data: TransferData) {
  const tr = await prisma.stockTransfer.findFirst({ where: { id, tenantId }, select: { status: true } })
  if (!tr) throw new BusinessError('Transfert introuvable', 404)
  if (tr.status !== TransferStatus.DRAFT) throw new BusinessError('Seul un transfert brouillon est modifiable', 409)
  if (data.fromWarehouseId === data.toWarehouseId) throw new BusinessError('Dépôts source et destination identiques', 400)
  await assertActiveWarehouse(tenantId, data.fromWarehouseId)
  await assertActiveWarehouse(tenantId, data.toWarehouseId)
  await assertAllBelongToTenant('product', data.items.map(i => i.productId), tenantId)
  return prisma.$transaction(async (tx) => {
    await tx.stockTransferItem.deleteMany({ where: { transferId: id } })
    return tx.stockTransfer.update({
      where: { id },
      data: {
        fromWarehouseId: data.fromWarehouseId,
        toWarehouseId: data.toWarehouseId,
        date: data.date ?? undefined,
        notes: data.notes || null,
        items: { create: data.items.map(i => ({ productId: i.productId, quantity: i.quantity, notes: i.notes || null })) },
      },
      include: { items: true },
    })
  })
}

/** Validation : crée atomiquement les mouvements de sortie (source) et d'entrée (destination). */
export async function validateTransfer(id: string, tenantId: string, userId?: string | null) {
  const settings = await getStockSettings(tenantId)
  return prisma.$transaction(async (tx) => {
    // Réservation atomique du statut : empêche une double validation concurrente
    const claimed = await tx.stockTransfer.updateMany({
      where: { id, tenantId, status: { in: [TransferStatus.DRAFT, TransferStatus.IN_PROGRESS] } },
      data: { status: TransferStatus.TRANSFERRED, validatedAt: new Date() },
    })
    if (claimed.count === 0) {
      const exists = await tx.stockTransfer.count({ where: { id, tenantId } })
      throw new BusinessError(exists ? 'Ce transfert est déjà validé ou annulé' : 'Transfert introuvable', exists ? 409 : 404)
    }
    const transfer = await tx.stockTransfer.findUnique({
      where: { id },
      include: { items: true, fromWarehouse: { select: { code: true, isActive: true } }, toWarehouse: { select: { code: true, isActive: true } } },
    })
    if (!transfer) throw new BusinessError('Transfert introuvable', 404)
    if (!transfer.fromWarehouse.isActive || !transfer.toWarehouse.isActive) throw new BusinessError('Ce dépôt est archivé', 409)

    // Contrôle global (lignes cumulées) avant toute écriture
    const sourceStock = await tx.productWarehouse.findMany({
      where: { warehouseId: transfer.fromWarehouseId, productId: { in: transfer.items.map(i => i.productId) } },
      select: { productId: true, stock: true },
    })
    const plan = planTransfer(
      transfer.fromWarehouseId, transfer.toWarehouseId,
      transfer.items.map(i => ({ productId: i.productId, quantity: Number(i.quantity) })),
      Object.fromEntries(sourceStock.map(s => [s.productId, Number(s.stock)])),
      settings.allowNegativeStock,
    )
    if (!plan.ok) {
      if (plan.error === 'INSUFFICIENT_STOCK') {
        const codes = await tx.product.findMany({ where: { id: { in: plan.shortages.map(s => s.productId) } }, select: { id: true, code: true } })
        const label = plan.shortages.map(s => `${codes.find(c => c.id === s.productId)?.code ?? s.productId} (${s.available}/${s.requested})`).join(', ')
        throw new BusinessError(`Stock insuffisant dans le dépôt source : ${label}`, 409)
      }
      throw new BusinessError('Transfert invalide', 400)
    }

    for (const [productId, qty] of Object.entries(plan.totals)) {
      const common = {
        tenantId, productId, type: StockMovementType.TRANSFER, reference: transfer.reference,
        sourceType: 'TRANSFER', sourceId: transfer.id, createdById: userId ?? null,
        allowNegative: settings.allowNegativeStock, reason: 'TRANSFER',
      }
      await applyMovementTx(tx, { ...common, warehouseId: transfer.fromWarehouseId, quantity: -qty, notes: `→ ${transfer.toWarehouse.code}` })
      await applyMovementTx(tx, { ...common, warehouseId: transfer.toWarehouseId, quantity: qty, notes: `← ${transfer.fromWarehouse.code}` })
    }

    return tx.stockTransfer.findUnique({
      where: { id },
      include: { items: { include: { product: { select: { name: true, code: true } } } } },
    })
  })
}

export async function cancelTransfer(id: string, tenantId: string) {
  const res = await prisma.stockTransfer.updateMany({
    where: { id, tenantId, status: { in: [TransferStatus.DRAFT, TransferStatus.IN_PROGRESS] } },
    data: { status: TransferStatus.CANCELLED },
  })
  if (res.count === 0) throw new BusinessError('Seul un transfert non validé peut être annulé', 409)
  return { success: true }
}

export async function deleteTransfer(id: string, tenantId: string) {
  const tr = await prisma.stockTransfer.findFirst({ where: { id, tenantId }, select: { status: true } })
  if (!tr) throw new BusinessError('Transfert introuvable', 404)
  if (tr.status !== TransferStatus.DRAFT && tr.status !== TransferStatus.CANCELLED) throw new BusinessError('Un transfert validé ne peut pas être supprimé', 409)
  await prisma.stockTransfer.delete({ where: { id } })
  return { success: true }
}

// ─── Inventaire ─────────────────────────────────────────────

const OPEN_INVENTORY: InventoryStatus[] = [InventoryStatus.DRAFT, InventoryStatus.IN_PROGRESS]

/** Ouvre une session d'inventaire et fige le stock théorique du dépôt. */
export async function createInventory(tenantId: string, data: z.infer<typeof createInventorySchema>) {
  await assertActiveWarehouse(tenantId, data.warehouseId)
  if (data.scope === 'CATEGORY' && !data.category) throw new BusinessError('Catégorie requise', 400)
  const open = await prisma.inventory.count({ where: { tenantId, warehouseId: data.warehouseId, status: { in: OPEN_INVENTORY } } })
  if (open > 0) throw new BusinessError('INVENTORY_ALREADY_OPEN', 409)

  return prisma.$transaction(async (tx) => {
    const categoryFilter = data.scope === 'CATEGORY' ? { category: data.category } : {}
    const products = await tx.product.findMany({
      where: {
        tenantId,
        ...categoryFilter,
        OR: [{ isActive: true }, { warehouseStock: { some: { warehouseId: data.warehouseId, NOT: { stock: 0 } } } }],
      },
      select: {
        id: true, averageCost: true, purchasePrice: true,
        warehouseStock: { where: { warehouseId: data.warehouseId }, select: { stock: true } },
      },
      orderBy: { code: 'asc' },
    })
    if (!products.length) throw new BusinessError('Aucun produit à inventorier', 400)
    const reference = await nextReference(tx, 'inventory', tenantId)
    return tx.inventory.create({
      data: {
        tenantId,
        warehouseId: data.warehouseId,
        reference,
        date: data.date ?? new Date(),
        status: InventoryStatus.DRAFT,
        scope: data.scope,
        category: data.scope === 'CATEGORY' ? data.category : null,
        notes: data.notes || null,
        items: {
          create: products.map(p => {
            const expected = Number(p.warehouseStock[0]?.stock ?? 0)
            return {
              productId: p.id,
              warehouseId: data.warehouseId,
              expectedQty: expected,
              actualQty: expected,
              counted: false,
              variance: 0,
              unitCost: valuationCost(Number(p.averageCost), Number(p.purchasePrice)),
            }
          }),
        },
      },
      select: { id: true, reference: true },
    })
  })
}

export async function saveInventoryCounts(tenantId: string, id: string, counts: z.infer<typeof inventoryCountsSchema>['counts']) {
  const inv = await prisma.inventory.findFirst({ where: { id, tenantId }, select: { status: true } })
  if (!inv) throw new BusinessError('Inventaire introuvable', 404)
  if (!OPEN_INVENTORY.includes(inv.status)) throw new BusinessError('Inventaire clôturé', 409)
  return prisma.$transaction(async (tx) => {
    let updated = 0
    for (const c of counts) {
      const item = await tx.inventoryItem.findFirst({ where: { id: c.itemId, inventoryId: id }, select: { expectedQty: true } })
      if (!item) continue
      const counted = c.actualQty !== null && c.actualQty !== undefined
      const actual = counted ? Number(c.actualQty) : Number(item.expectedQty)
      await tx.inventoryItem.update({
        where: { id: c.itemId },
        data: {
          actualQty: actual,
          counted,
          variance: counted ? round3(actual - Number(item.expectedQty)) : 0,
          ...(c.notes !== undefined ? { notes: c.notes || null } : {}),
        },
      })
      updated++
    }
    if (inv.status === InventoryStatus.DRAFT && updated > 0) {
      await tx.inventory.update({ where: { id }, data: { status: InventoryStatus.IN_PROGRESS } })
    }
    return { updated }
  })
}

/** Validation : génère les mouvements d'ajustement (écart = compté − théorique figé). */
export async function validateInventory(id: string, tenantId: string, opts: { uncountedAsZero?: boolean; userId?: string | null } = {}) {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.inventory.updateMany({
      where: { id, tenantId, status: { in: OPEN_INVENTORY } },
      data: { status: InventoryStatus.VALIDATED, validatedAt: new Date() },
    })
    if (claimed.count === 0) {
      const exists = await tx.inventory.count({ where: { id, tenantId } })
      throw new BusinessError(exists ? 'Cet inventaire est déjà validé ou annulé' : 'Inventaire introuvable', exists ? 409 : 404)
    }
    const inventory = await tx.inventory.findUnique({ where: { id }, include: { items: true } })
    if (!inventory?.warehouseId) throw new BusinessError('Aucun dépôt associé à cet inventaire', 400)

    if (opts.uncountedAsZero) {
      await tx.inventoryItem.updateMany({ where: { inventoryId: id, counted: false }, data: { actualQty: 0, counted: true } })
      for (const it of inventory.items.filter(i => !i.counted)) {
        await tx.inventoryItem.update({ where: { id: it.id }, data: { variance: round3(-Number(it.expectedQty)) } })
      }
    }

    const adjustments = inventoryAdjustments(
      inventory.items.map(i => ({
        productId: i.productId,
        expectedQty: Number(i.expectedQty),
        actualQty: Number(i.actualQty),
        counted: i.counted,
        unitCost: Number(i.unitCost ?? 0),
      })),
      { uncountedAsZero: opts.uncountedAsZero },
    )
    for (const a of adjustments) {
      await applyMovementTx(tx, {
        tenantId,
        productId: a.productId,
        warehouseId: inventory.warehouseId,
        type: StockMovementType.ADJUSTMENT,
        quantity: a.delta,
        reference: inventory.reference,
        reason: 'INVENTORY',
        notes: `Inventaire ${inventory.reference}`,
        sourceType: 'INVENTORY',
        sourceId: inventory.id,
        createdById: opts.userId ?? null,
        // L'inventaire constate la réalité : l'ajustement n'est jamais bloqué
        allowNegative: true,
      })
    }
    return { id, reference: inventory.reference, adjustments: adjustments.length }
  })
}

export async function cancelInventory(id: string, tenantId: string) {
  const res = await prisma.inventory.updateMany({
    where: { id, tenantId, status: { in: OPEN_INVENTORY } },
    data: { status: InventoryStatus.CANCELLED },
  })
  if (res.count === 0) throw new BusinessError('Seul un inventaire non validé peut être annulé', 409)
  return { success: true }
}

// ─── Alertes, valorisation, tableau de bord ─────────────────

type ProductForReport = {
  id: string; code: string; name: string; category: string | null; unit: string
  currentStock: Prisma.Decimal; averageCost: Prisma.Decimal; purchasePrice: Prisma.Decimal
  minStock: Prisma.Decimal; reorderPoint: Prisma.Decimal; reorderQty: Prisma.Decimal
  warehouseStock: Array<{ warehouseId: string; stock: Prisma.Decimal; minStock: Prisma.Decimal | null }>
}

async function loadProductsForReport(tenantId: string): Promise<ProductForReport[]> {
  return prisma.product.findMany({
    where: { tenantId, isActive: true },
    select: {
      id: true, code: true, name: true, category: true, unit: true,
      currentStock: true, averageCost: true, purchasePrice: true,
      minStock: true, reorderPoint: true, reorderQty: true,
      warehouseStock: { select: { warehouseId: true, stock: true, minStock: true } },
    },
    orderBy: { code: 'asc' },
  })
}

export async function getStockAlerts(tenantId: string) {
  const [products, warehouses] = await Promise.all([
    loadProductsForReport(tenantId),
    prisma.warehouse.findMany({ where: { tenantId, isActive: true }, select: { id: true, code: true, name: true } }),
  ])
  const whMap = new Map(warehouses.map(w => [w.id, w]))
  const lowStock = []
  const toOrder = []
  const depotAlerts = []
  for (const p of products) {
    const stock = Number(p.currentStock)
    const min = Number(p.minStock)
    const rp = Number(p.reorderPoint)
    const cost = valuationCost(Number(p.averageCost), Number(p.purchasePrice))
    const base = { productId: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit, stock: round3(stock), minStock: min, reorderPoint: rp, unitCost: cost }
    if (isLowStock(stock, min, rp)) {
      lowStock.push({ ...base, threshold: alertThreshold(min, rp), outOfStock: stock <= 0 })
      const qty = suggestedOrderQty(stock, min, rp, Number(p.reorderQty))
      if (qty > 0) toOrder.push({ ...base, suggestedQty: qty, estimatedCost: stockValue(qty, cost) })
    }
    for (const pw of p.warehouseStock) {
      if (pw.minStock === null || !whMap.has(pw.warehouseId)) continue
      if (isLowStock(Number(pw.stock), Number(pw.minStock))) {
        const w = whMap.get(pw.warehouseId)!
        depotAlerts.push({ ...base, warehouseId: w.id, warehouseCode: w.code, warehouseName: w.name, depotStock: round3(Number(pw.stock)), depotMinStock: Number(pw.minStock) })
      }
    }
  }
  return {
    lowStock,
    toOrder,
    depotAlerts,
    totals: {
      lowStock: lowStock.length,
      outOfStock: lowStock.filter(l => l.outOfStock).length,
      toOrderValue: round3(toOrder.reduce((s, r) => s + r.estimatedCost, 0)),
    },
  }
}

export async function getStockValuation(tenantId: string, warehouseId?: string | null) {
  const [products, warehouses] = await Promise.all([
    loadProductsForReport(tenantId),
    prisma.warehouse.findMany({ where: { tenantId }, select: { id: true, code: true, name: true, isActive: true }, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
  ])
  const byWarehouse: Record<string, { qty: number; value: number }> = Object.fromEntries(warehouses.map(w => [w.id, { qty: 0, value: 0 }]))
  const rows = products.map(p => {
    const cost = valuationCost(Number(p.averageCost), Number(p.purchasePrice))
    const perWarehouse: Record<string, number> = {}
    let assigned = 0
    for (const pw of p.warehouseStock) {
      const q = Number(pw.stock)
      perWarehouse[pw.warehouseId] = round3(q)
      assigned += q
      if (byWarehouse[pw.warehouseId]) {
        byWarehouse[pw.warehouseId].qty += q
        byWarehouse[pw.warehouseId].value += q * cost
      }
    }
    const qty = warehouseId ? (perWarehouse[warehouseId] ?? 0) : Number(p.currentStock)
    return {
      productId: p.id, code: p.code, name: p.name, category: p.category, unit: p.unit,
      perWarehouse,
      unassigned: round3(Number(p.currentStock) - assigned),
      qty: round3(qty),
      unitCost: cost,
      value: stockValue(qty, cost),
    }
  }).filter(r => r.qty !== 0 || !warehouseId)
  return {
    warehouses: warehouses.map(w => ({ ...w, qty: round3(byWarehouse[w.id].qty), value: round3(byWarehouse[w.id].value) })),
    rows,
    totalQty: round3(rows.reduce((s, r) => s + r.qty, 0)),
    totalValue: round3(rows.reduce((s, r) => s + r.value, 0)),
  }
}

export async function getStockDashboard(tenantId: string) {
  const [valuation, alerts, recent, openTransfers, openInventories, products] = await Promise.all([
    getStockValuation(tenantId),
    getStockAlerts(tenantId),
    prisma.stockMovement.findMany({
      where: { tenantId },
      include: { product: { select: { id: true, code: true, name: true, unit: true } }, warehouse: { select: { code: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.stockTransfer.count({ where: { tenantId, status: { in: [TransferStatus.DRAFT, TransferStatus.IN_PROGRESS] } } }),
    prisma.inventory.count({ where: { tenantId, status: { in: OPEN_INVENTORY } } }),
    prisma.product.count({ where: { tenantId, isActive: true } }),
  ])
  return {
    kpis: {
      totalValue: valuation.totalValue,
      products,
      itemsInStock: valuation.rows.filter(r => r.qty > 0).length,
      lowStock: alerts.totals.lowStock,
      outOfStock: alerts.totals.outOfStock,
      openTransfers,
      openInventories,
    },
    warehouses: valuation.warehouses.filter(w => w.isActive),
    lowStock: alerts.lowStock.slice(0, 8),
    recentMovements: recent,
  }
}
