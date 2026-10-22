import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { handleApiError } from '@/lib/errors'
import { generateSufferedFromInvoice } from '@/services/withholding-tax'

/**
 * POST /api/commercial/invoices/[id]/generer-rs
 *
 * Enregistre la retenue à la source SUBIE sur une facture de vente : opérée par le client au
 * paiement et déclarée par LUI au TEJ. Côté tenant : créance sur l'État (compte 4341) et
 * certificat de retenue à réclamer ; la RS n'entre jamais dans l'export TEJ du tenant.
 *
 * Body (optionnel) : serviceType, beneficiaryRegime (régime du tenant), periodYear, periodMonth, grossAmount, notes
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const rs = await generateSufferedFromInvoice(id, ctx.tenantId, {
      serviceType: typeof body?.serviceType === 'string' ? body.serviceType : null,
      beneficiaryRegime: typeof body?.beneficiaryRegime === 'string' ? body.beneficiaryRegime : null,
      periodYear: body?.periodYear ? Number(body.periodYear) : undefined,
      periodMonth: body?.periodMonth ? Number(body.periodMonth) : undefined,
      grossAmount: body?.grossAmount ? Number(body.grossAmount) : null,
      notes: typeof body?.notes === 'string' ? body.notes : null,
    })
    // L'enregistrement est renvoyé à plat (la fiche facture affiche rate / taxAmount / netAmount)
    return NextResponse.json({
      ...rs,
      message: 'Retenue subie enregistrée — certificat de retenue à réclamer au client',
      summary: {
        montantTTC: Number(rs.grossAmount).toFixed(3),
        taux: `${(Number(rs.rate) * 100).toFixed(2)}%`,
        montantRS: Number(rs.taxAmount).toFixed(3),
        netEncaisse: Number(rs.netAmount).toFixed(3),
        periode: `${rs.periodMonth}/${rs.periodYear}`,
      },
    }, { status: 201 })
  } catch (e) {
    return handleApiError(e, 'POST generer-rs')
  }
}
