import { requireTenant, requireSession } from '@/lib/api-auth'
import { readImportRows, safeErrorMessage, importErrorResponse, importFileError } from '@/lib/security/import-limits'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { createProduct } from '@/services/products'

const REQUIRED = ['code', 'name']
const OPTIONAL = ['barcode','description','category','unit','purchasePrice','salePrice','vatRate','fodec','minStock','reorderPoint','reorderQty','initialStock']

function toBool(v: any): boolean {
  if (v === null || v === undefined) return false
  if (typeof v === 'boolean') return v
  const s = String(v).toLowerCase().trim()
  if (s === 'true' || s === '1' || s === 'oui' || s === 'yes') return true
  return false
}

function toNum(v: any, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return isNaN(n) ? fallback : n
}

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    // requireTenant (et non resolveTenantContext) : révocation cabinet + rôle revérifiés en base
    const tenantCtx = await requireTenant(req, formData.get('tenantId') as string | null)
    if (tenantCtx instanceof NextResponse) return tenantCtx
    const tenantId = tenantCtx.tenantId

    if (!file || !tenantId) {
      return NextResponse.json({ error: 'Fichier et tenantId requis' }, { status: 400 })
    }

    const fileErr = importFileError(file)
    if (fileErr) return NextResponse.json({ error: fileErr }, { status: 400 })
    // 5 Mo / 5 000 lignes maximum
    const rows: any[] = await readImportRows(file)

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Fichier vide' }, { status: 400 })
    }

    const headers = Object.keys(rows[0])
    const missing = REQUIRED.filter(h => !headers.map(x => x.toLowerCase()).includes(h.toLowerCase()))
    if (missing.length > 0) {
      return NextResponse.json({ error: `Colonnes requises manquantes: ${missing.join(', ')}` }, { status: 400 })
    }

    const log: any[] = []
    const errors: any[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      const get = (key: string) => {
        const k = headers.find(h => h.toLowerCase() === key.toLowerCase())
        return k ? row[k] : undefined
      }

      const code = String(get('code') || '').trim()
      const name = String(get('name') || '').trim()

      if (!code || !name) {
        errors.push({ row: rowNum, error: 'code ou name manquant' })
        continue
      }

      try {
        const existing = await prisma.product.findUnique({
          where: { tenantId_code: { tenantId, code } },
        })

        if (existing) {
          errors.push({ row: rowNum, code, error: 'Code déjà utilisé' })
          continue
        }

        // Création via le service : le stock initial passe par un mouvement d'entrée (dépôt par défaut)
        await createProduct({
          tenantId,
          code,
          barcode: String(get('barcode') || '').trim() || undefined,
          name,
          description: String(get('description') || '').trim() || undefined,
          category: String(get('category') || '').trim() || undefined,
          unit: String(get('unit') || 'unit').trim() || 'unit',
          purchasePrice: Math.max(0, toNum(get('purchasePrice'))),
          salePrice: Math.max(0, toNum(get('salePrice'))),
          vatRate: Math.min(100, Math.max(0, toNum(get('vatRate'), 19))),
          fodec: toBool(get('fodec')),
          minStock: Math.max(0, toNum(get('minStock'))),
          reorderPoint: Math.max(0, toNum(get('reorderPoint'))),
          reorderQty: Math.max(0, toNum(get('reorderQty'))),
          initialStock: Math.max(0, toNum(get('initialStock'), toNum(get('currentStock')))),
          warehouseId: null,
        }, session.id)

        log.push({ row: rowNum, code, name, status: 'created' })
      } catch (e: any) {
        errors.push({ row: rowNum, code, error: safeErrorMessage(e) })
      }
    }

    return NextResponse.json({
      total: rows.length,
      imported: log.length,
      failed: errors.length,
      log,
      errors,
    })
  } catch (error: any) {
    return importErrorResponse(error, 'Import error:')
  }
}
