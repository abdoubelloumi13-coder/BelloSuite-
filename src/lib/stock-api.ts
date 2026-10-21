/** Aides communes aux routes /api/stock/* (rôles, lecture des paramètres). */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { ApiContext } from '@/lib/api'

/** Opérations sensibles (paramètres, référentiels, suppression de dépôt, validation d'inventaire). */
export function isStockAdmin(ctx: ApiContext): boolean {
  return ctx.userRole === 'ADMIN' || ctx.userRole === 'SUPER_ADMIN'
}

export function forbidden() {
  return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
}

/** Lecture tolérante du corps JSON (corps vide → {}). */
export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json()
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().nullable(),
})

export const unitSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(60),
  decimals: z.coerce.number().int().min(0).max(3).default(0),
})

const num0 = z.preprocess(v => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).default(0))

export const createProductSchema = z.object({
  tenantId: z.string().min(1, 'tenantId requis'),
  code: z.string().trim().min(1, 'Code requis').max(60, '60 caractères maximum'),
  name: z.string().trim().min(1, 'Nom requis').max(200, '200 caractères maximum'),
  description: z.string().optional(),
  /** Catégorie en texte libre (facultative) : créée/associée dans ProductCategory à l'enregistrement */
  category: z.string().trim().max(80, '80 caractères maximum').optional().nullable(),
  unit: z.preprocess(v => (v === '' || v === null ? undefined : v), z.string().trim().max(20).default('unit')),
  purchasePrice: num0,
  salePrice: num0,
  vatRate: z.preprocess(v => (v === '' || v === null || v === undefined ? undefined : v), z.coerce.number().min(0).max(100).default(19)),
  fodec: z.preprocess(v => (v === 'true' ? true : v === 'false' ? false : v), z.boolean().default(false)),
  minStock: num0,
  reorderPoint: num0,
  reorderQty: num0,
  initialStock: num0,
  /** Dépôt recevant le stock initial (défaut : dépôt par défaut) */
  warehouseId: z.string().optional().nullable(),
  barcode: z.string().optional(),
  /** URLs d'images (envoyées par le formulaire, auparavant ignorées) */
  images: z.array(z.string().trim().max(2000)).max(20).optional(),
  /** Variantes libres (taille, couleur…) */
  variants: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
})

/**
 * Erreur Prisma « colonne / table absente » (P2022 / P2021) : la base de production a dérivé du schéma.
 * Renvoie un message français explicite (code DB_SCHEMA_DRIFT) au lieu d'un 500 muet.
 */
export function schemaDriftResponse(err: unknown): NextResponse | null {
  const e = err as { code?: unknown; meta?: { column?: unknown; table?: unknown } } | null
  if (!e || (e.code !== 'P2022' && e.code !== 'P2021')) return null
  const what = e.code === 'P2022' ? `colonne manquante ${String(e.meta?.column ?? '')}` : `table manquante ${String(e.meta?.table ?? '')}`
  console.error('[stock] dérive schéma/base :', what)
  return NextResponse.json({
    error: `La base de données n'est pas à jour (${what.trim()}). L'administrateur doit exécuter la migration supabase/migrations/20261022000500_stock_pos_reminders_sync.sql.`,
    code: 'DB_SCHEMA_DRIFT',
  }, { status: 500 })
}

/** 403 français pour les opérations stock réservées aux administrateurs. */
export function forbiddenStockAdmin(action: string) {
  return NextResponse.json({ error: `Droits insuffisants : seul un administrateur peut ${action}.` }, { status: 403 })
}
