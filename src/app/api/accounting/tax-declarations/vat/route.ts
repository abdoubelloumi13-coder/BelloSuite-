import { requireAccess } from '@/lib/rbac'
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getVATSummary, getVATDeclaration, postVATLiquidationToAccounting } from '@/services/accounting'

// GET /api/accounting/tax-declarations/vat?month=X&year=Y[&previousCredit=Z]
// Déclaration calculée depuis les documents (ventes/avoirs/factures fournisseurs) + rapprochement avec la comptabilité
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await getApiContext(req, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx

    const now = new Date()
    const m = parseInt(searchParams.get('month') || '', 10)
    const y = parseInt(searchParams.get('year') || '', 10)
    const month = Number.isInteger(m) && m >= 1 && m <= 12 ? m : now.getMonth() + 1
    const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : now.getFullYear()
    const previousCredit = Number(searchParams.get('previousCredit') || 0) || 0

    const [declaration, ledger] = await Promise.all([
      getVATDeclaration(month, year, ctx.tenantId, previousCredit),
      getVATSummary(month, year, ctx.tenantId),
    ])
    return NextResponse.json({
      ...declaration,
      // compatibilité : anciens champs (issus des écritures comptables)
      collectedVAT: ledger.collectedVAT,
      deductibleVAT: ledger.deductibleVAT,
      netVAT: ledger.netVAT,
      accounting: ledger,
    })
  } catch (err) {
    return handleApiError(err, 'GET vat summary')
  }
}

// POST /api/accounting/tax-declarations/vat
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { month, year, tenantId: bodyTenantId } = body

    const ctx = await getApiContext(req, bodyTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'accounting:write')
    if (accessDenied) return accessDenied

    if (!month || !year) {
      return NextResponse.json({ error: 'Mois et année requis' }, { status: 400 })
    }

    const entry = await postVATLiquidationToAccounting(Number(month), Number(year), ctx.tenantId)
    return NextResponse.json(entry)
  } catch (err) {
    return handleApiError(err, 'POST vat liquidation')
  }
}
