import { requireTenant, requireSession, resolveTenantContext } from '@/lib/api-auth'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sanitizePaieParamsInput } from '@/lib/payroll'
import { payrollErrorMessage } from '@/lib/payroll-payslip'


// GET /api/hr/paie/parameters - Get or create parameters for tenant/year
export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session
  try {
    const { searchParams } = new URL(req.url);
    const tenantCtx = resolveTenantContext(session, searchParams.get("tenantId") as string | null)
    if ('error' in tenantCtx) return NextResponse.json({ error: tenantCtx.error }, { status: tenantCtx.status })
    const tenantId = tenantCtx.tenantId
    if (!tenantId) {
      return NextResponse.json({ error: "Société (tenantId) requise" }, { status: 400 });
    }

    // Une seule ligne de paramètres par société (tenantId @unique) : upsert, jamais de 2e create (ancien 500)
    const params = await prisma.paieParameters.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId },
    });

    return NextResponse.json(params);
  } catch (error) {
    console.error("Error fetching paie parameters:", error);
    return NextResponse.json({ error: payrollErrorMessage(error, "Paramètres de paie indisponibles") }, { status: 500 });
  }
}

// PUT /api/hr/paie/parameters - Update parameters (upsert par société)
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Requête invalide (JSON attendu)" }, { status: 400 });
    }
    const { tenantId: requestedTenantId, ...updateData } = body;
    const ctx = await requireTenant(req, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: "Société (tenantId) requise" }, { status: 400 });
    }

    const current = await prisma.paieParameters.findUnique({ where: { tenantId } });
    const clean = sanitizePaieParamsInput(updateData, current as unknown as Record<string, unknown> | null);
    if (clean.error !== undefined) return NextResponse.json({ error: clean.error }, { status: 400 });

    const params = await prisma.paieParameters.upsert({
      where: { tenantId },
      update: clean.data as any, // TODO prisma generate (nouveaux champs 2026)
      create: { tenantId, ...clean.data } as any,
    });

    return NextResponse.json(params);
  } catch (error) {
    console.error("Error updating paie parameters:", error);
    return NextResponse.json({ error: payrollErrorMessage(error, "Enregistrement des paramètres de paie impossible") }, { status: 500 });
  }
}