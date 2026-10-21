import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getEInvoiceSettings, saveEInvoiceSettings } from '@/lib/einvoice/store'
import { testCertificateDetails } from '@/lib/einvoice/xades-signer'

export const runtime = 'nodejs'

// GET /api/commercial/einvoice/settings — paramètres « Signature électronique » + certificat de test
export async function GET(req: NextRequest) {
  try {
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json({ settings: await getEInvoiceSettings(ctx.tenantId), testCertificate: testCertificateDetails() })
  } catch (err) {
    return handleApiError(err, 'GET einvoice settings')
  }
}

// PUT /api/commercial/einvoice/settings — { mode, signerName, signerRole, signerEmail }
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const ctx = await getApiContext(req, body?.tenantId ?? new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json({ settings: await saveEInvoiceSettings(ctx.tenantId, body), testCertificate: testCertificateDetails() })
  } catch (err) {
    return handleApiError(err, 'PUT einvoice settings')
  }
}
