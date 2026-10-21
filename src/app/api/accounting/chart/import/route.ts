import { requireTenant, requireSession } from '@/lib/api-auth'
import { readImportRows, safeErrorMessage, importErrorResponse, importFileError } from '@/lib/security/import-limits'
import { requireAccess } from '@/lib/rbac'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { AccountType } from '@prisma/client'

const REQUIRED = ['accountNumber', 'name', 'type']
const VALID_TYPES: AccountType[] = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']

function normalizeType(t: string): AccountType | null {
  const upper = t.toUpperCase().trim()
  if (VALID_TYPES.includes(upper as AccountType)) return upper as AccountType
  const map: Record<string, AccountType> = {
    actif: 'ASSET', asset: 'ASSET',
    passif: 'LIABILITY', liability: 'LIABILITY',
    capital: 'EQUITY', equity: 'EQUITY',
    produit: 'REVENUE', revenue: 'REVENUE', recette: 'REVENUE',
    charge: 'EXPENSE', depense: 'EXPENSE', expense: 'EXPENSE',
  }
  return map[upper] ?? null
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
    const denied = requireAccess(tenantCtx, 'accounting:write')
    if (denied) return denied
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

      const accountNumber = String(get('accountNumber') || '').trim()
      const name = String(get('name') || '').trim()
      const typeRaw = String(get('type') || '').trim()
      const parentAccountNumber = String(get('parentAccountNumber') || '').trim()

      if (!accountNumber || !name) {
        errors.push({ row: rowNum, error: 'accountNumber ou name manquant' })
        continue
      }

      const type = normalizeType(typeRaw)
      if (!type) {
        errors.push({ row: rowNum, accountNumber, error: `Type invalide: "${typeRaw}". Types valides: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE` })
        continue
      }

      try {
        let parentId: string | null = null
        if (parentAccountNumber) {
          const parent = await prisma.accountingAccount.findUnique({
            where: { tenantId_accountNumber: { tenantId, accountNumber: parentAccountNumber } },
          })
          parentId = parent?.id ?? null
        }

        const existing = await prisma.accountingAccount.findUnique({
          where: { tenantId_accountNumber: { tenantId, accountNumber } },
        })

        if (existing) {
          errors.push({ row: rowNum, accountNumber, error: 'Numéro de compte déjà existant' })
          continue
        }

        const account = await prisma.accountingAccount.create({
          data: { tenantId, accountNumber, name, type, parentId: parentId || undefined },
        })

        log.push({ row: rowNum, accountNumber, name, type, status: 'created' })
      } catch (e: any) {
        errors.push({ row: rowNum, accountNumber, error: safeErrorMessage(e) })
      }
    }

    return NextResponse.json({ total: rows.length, imported: log.length, failed: errors.length, log, errors })
  } catch (error: any) {
    return importErrorResponse(error, 'Chart import error:')
  }
}