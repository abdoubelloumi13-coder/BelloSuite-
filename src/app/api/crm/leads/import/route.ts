import { requireTenant, requireSession, resolveTenantContext } from '@/lib/api-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import * as XLSX from 'xlsx'
import { importLeadsFromCSV } from '@/services/leads'

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session

  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const tenantCtx = resolveTenantContext(session, formData.get('tenantId') as string | null)
    if ('error' in tenantCtx) return NextResponse.json({ error: tenantCtx.error }, { status: tenantCtx.status })
    const tenantId = tenantCtx.tenantId

    if (!file || !tenantId) {
      return NextResponse.json({ error: 'Fichier et tenantId requis' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Fichier vide' }, { status: 400 })
    }

    const headers = Object.keys(rows[0])
    const headerMap: Record<string, string> = {}
    headers.forEach(h => { headerMap[h.toLowerCase()] = h })

    const result = await importLeadsFromCSV(tenantId, rows, headerMap)
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Lead import error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}