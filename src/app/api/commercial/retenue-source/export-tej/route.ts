import { requireTenant, requireSession, resolveTenantContext } from '@/lib/api-auth'
import { NextResponse } from 'next/server';
import { exportTEJ, TEJValidationError } from '@/lib/tej-generator';

// GET /api/commercial/retenue-source/export-tej?tenantId=&periodYear=&periodMonth=
//   → télécharge le fichier XML TEJ prêt pour la plateforme https://tej.finances.gov.tn
//
// POST /api/commercial/retenue-source/export-tej
//   body: { tenantId, periodYear, periodMonth, withholdingTaxIds? }
//   → même effet en JSON (pour usage programme)
export async function GET(req: Request) {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session
  try {
    const { searchParams } = new URL(req.url);
    const tenantCtx = resolveTenantContext(session, searchParams.get('tenantId') as string | null)
    if ('error' in tenantCtx) return NextResponse.json({ error: tenantCtx.error }, { status: tenantCtx.status })
    const tenantId = tenantCtx.tenantId
    const periodYear  = searchParams.get('periodYear');
    const periodMonth = searchParams.get('periodMonth');
    if (!tenantId || !periodYear || !periodMonth) {
      return NextResponse.json(
        { error: 'tenantId, periodYear, periodMonth required' }, { status: 400 }
      );
    }
    const { xml, filename, count } = await exportTEJ({
      tenantId,
      periodYear: Number(periodYear),
      periodMonth: Number(periodMonth),
    });
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-TEJ-Count': String(count),
        'X-TEJ-Period': `${periodYear}-${periodMonth.padStart(2,'0')}`,
      },
    });
  } catch (e: any) {
    if (e instanceof TEJValidationError) {
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    }
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tenantId: requestedTenantId, periodYear, periodMonth, withholdingTaxIds } = body;
    const ctx = await requireTenant(req, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId
    if (!tenantId || !periodYear || !periodMonth) {
      return NextResponse.json(
        { error: 'tenantId, periodYear, periodMonth required' }, { status: 400 }
      );
    }
    const result = await exportTEJ({ tenantId, periodYear: Number(periodYear),
      periodMonth: Number(periodMonth), withholdingTaxIds });
    return NextResponse.json({ ...result, tejUrl: 'https://tej.finances.gov.tn' });
  } catch (e: any) {
    if (e instanceof TEJValidationError) {
      return NextResponse.json({ error: e.message, issues: e.issues }, { status: 422 });
    }
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
