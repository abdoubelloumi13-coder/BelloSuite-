import { z } from 'zod'
import { prisma } from '@/lib/db'
import { createProductSchema } from '@/lib/stock-api'
import { BusinessError } from '@/lib/errors'
import { Prisma, StockMovementType } from '@prisma/client'
import { applyMovementTx, ensureDefaultWarehouseId } from '@/services/stock'
import { assertBelongsToTenant } from '@/lib/tenant-scope'

type CreateProductData = z.infer<typeof createProductSchema>

/**
 * Liste des produits du tenant, avec le stock par dépôt.
 * (Plus de cache : le stock change à chaque mouvement et doit être lu à jour.)
 */
export async function getProducts(tenantId: string) {
  return prisma.product.findMany({
    where: { tenantId },
    include: { warehouseStock: { select: { warehouseId: true, stock: true, minStock: true } } },
    orderBy: { name: 'asc' },
  })
}

export async function createProduct(data: CreateProductData, userId?: string | null) {
  const { tenantId, code, name, description, category, unit, purchasePrice, salePrice, vatRate, fodec, minStock, reorderPoint, reorderQty, initialStock, barcode } = data

  const existing = await prisma.product.findUnique({
    where: { tenantId_code: { tenantId, code } },
  })
  if (existing) {
    throw new BusinessError('Code produit déjà utilisé', 409)
  }

  let warehouseId: string | null = null
  if (initialStock > 0) {
    await assertBelongsToTenant('warehouse', data.warehouseId, tenantId)
    // Aucun dépôt ? un « Dépôt principal » est créé automatiquement (sinon le stock initial serait orphelin)
    warehouseId = data.warehouseId || (await ensureDefaultWarehouseId(tenantId))
  }

  // Catégorie en texte libre : on l'associe à la catégorie existante (insensible à la casse) ou on la crée.
  const categoryName = await resolveCategoryName(tenantId, category)

  // Transaction : création du produit + mouvement d'entrée initial (le stock ne bouge que par mouvement)
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        tenantId,
        code,
        barcode: barcode || null,
        name,
        description: description || null,
        category: categoryName,
        unit,
        purchasePrice,
        averageCost: purchasePrice,
        salePrice,
        vatRate,
        fodec,
        minStock,
        reorderPoint,
        reorderQty,
        currentStock: 0,
        ...(data.images?.length ? { images: data.images.filter(Boolean) } : {}),
        ...(data.variants?.length ? { variants: data.variants as Prisma.InputJsonValue } : {}),
      },
    })

    if (initialStock > 0) {
      await applyMovementTx(tx, {
        tenantId,
        productId: product.id,
        warehouseId,
        type: StockMovementType.ENTRY,
        quantity: initialStock,
        unitCost: purchasePrice,
        reason: 'OPENING',
        notes: 'Stock initial',
        sourceType: 'OPENING',
        createdById: userId ?? null,
        allowNegative: true,
      })
    }

    return tx.product.findUnique({ where: { id: product.id } })
  })
}

/**
 * Normalise une catégorie saisie librement : renvoie le nom de la catégorie existante (même casse que le
 * référentiel) ou crée la catégorie. Une erreur sur le référentiel (table absente en base dérivée…)
 * n'empêche pas la création de l'article : le texte est conservé tel quel.
 */
export async function resolveCategoryName(tenantId: string, raw: string | null | undefined): Promise<string | null> {
  const name = (raw ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return null
  try {
    const found = await prisma.productCategory.findFirst({
      where: { tenantId, name: { equals: name, mode: 'insensitive' } },
      select: { name: true },
    })
    if (found) return found.name
    const created = await prisma.productCategory.create({ data: { tenantId, name }, select: { name: true } })
    return created.name
  } catch (err) {
    if ((err as { code?: string })?.code === 'P2002') return name
    console.warn('[products] catégorie non enregistrée dans le référentiel :', (err as Error)?.message)
    return name
  }
}
