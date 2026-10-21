import { normalizeFiscalId } from '@/lib/matricule'
import { requireTenant, requireSession } from '@/lib/api-auth'
import { readImportRows, safeErrorMessage, importErrorResponse, importFileError } from '@/lib/security/import-limits'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

const REQUIRED = ['code', 'name']

function toNum(val: any, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
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
    const headerMap: Record<string, string> = {}
    headers.forEach(h => { headerMap[h.toLowerCase()] = h })

    const missing = REQUIRED.filter(f => !headerMap[f.toLowerCase()])
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Colonnes requises manquantes: ${missing.join(', ')}` },
        { status: 400 }
      )
    }

    const log: any[] = []
    const errors: any[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      const get = (key: string) => {
        const h = headerMap[key.toLowerCase()]
        return h !== undefined ? row[h] : undefined
      }

      const code = String(get('code') || '').trim()
      const name = String(get('name') || '').trim()

      if (!code || !name) {
        errors.push({ row: rowNum, error: 'code ou name manquant' })
        continue
      }

      const existing = await prisma.client.findUnique({
        where: { tenantId_code: { tenantId, code } },
      })
      if (existing) {
        errors.push({ row: rowNum, code, error: 'Code déjà utilisé' })
        continue
      }

      try {
        const client = await prisma.client.create({
          data: {
            tenantId,
            code,
            name,
            email: String(get('email') || '').trim() || null,
            phone: String(get('phone') || '').trim() || null,
            address: String(get('address') || '').trim() || null,
            city: String(get('city') || '').trim() || null,
            zipCode: String(get('zipCode') || '').trim() || null,
            country: String(get('country') || 'Tunisie').trim(),
            matriculeFiscal: normalizeFiscalId(String(get('matriculeFiscal') || '')) || null,
          },
        })
        log.push({ row: rowNum, code, name, id: client.id })
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
    return importErrorResponse(error, 'Client import error:')
  }
}
