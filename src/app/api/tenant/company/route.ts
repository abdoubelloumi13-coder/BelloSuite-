import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { companyProfileSchema, getCompanyProfile, saveCompanyProfile } from '@/lib/company-profile'

export const runtime = 'nodejs'

// GET /api/tenant/company — profil légal de l'entreprise émettrice (TEIF / impression)
export async function GET(req: NextRequest) {
  try {
    const ctx = await getApiContext(req, new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    return NextResponse.json(await getCompanyProfile(ctx.tenantId))
  } catch (err) {
    return handleApiError(err, 'GET tenant company')
  }
}

// PUT /api/tenant/company — { name, matriculeFiscal, address, city, zipCode, phone, email, rib }
// Toujours limité au tenant de la session (ADMIN / USER de l'entreprise).
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const ctx = await getApiContext(req, body?.tenantId ?? new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    if (!['ADMIN', 'USER', 'SUPER_ADMIN'].includes(ctx.userRole)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const data = parseBody(companyProfileSchema, body)
    if (data instanceof NextResponse) return data
    return NextResponse.json(await saveCompanyProfile(ctx.tenantId, data))
  } catch (err) {
    return handleApiError(err, 'PUT tenant company')
  }
}
