import { requireTenant, requireSession } from '@/lib/api-auth'
import { readImportRows, safeErrorMessage, importErrorResponse, importFileError } from '@/lib/security/import-limits'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { importLeadsFromCSV } from '@/services/leads'

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

    const result = await importLeadsFromCSV(tenantId, rows, headerMap)
    return NextResponse.json(result)
  } catch (error: any) {
    return importErrorResponse(error, 'Lead import error:')
  }
}