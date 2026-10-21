import { requireAccess } from '@/lib/rbac'
import { requireTenant, requireSession } from '@/lib/api-auth'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { stripUnsafeUpdateFields } from '@/lib/tenant-scope'


// Tunisia 2024 official IRPP tax brackets (revenus mensuels)
// Source: جدول الضريبة على الدخل
const DEFAULT_TAX_BRACKETS = [
  { min: 0,        max: 5000,   rate: 0.00 },
  { min: 5000,     max: 10000,  rate: 0.15 },
  { min: 10000,    max: 30000,  rate: 0.20 },
  { min: 30000,    max: 50000,  rate: 0.30 },
  { min: 50000,    max: 70000,  rate: 0.35 },
  { min: 70000,    max: Infinity, rate: 0.40 },
];

// GET /api/hr/paie/parameters - Get or create parameters for tenant/year
export async function GET(req: NextRequest) {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session
  try {
    const { searchParams } = new URL(req.url);
    // requireTenant : révocation cabinet + rôle revérifiés en base
    const tenantCtx = await requireTenant(req, searchParams.get("tenantId") as string | null)
    if (tenantCtx instanceof NextResponse) return tenantCtx
    const accessDenied = requireAccess(tenantCtx, 'hr:read')
    if (accessDenied) return accessDenied
    const tenantId = tenantCtx.tenantId
    const year = searchParams.get("year") || new Date().getFullYear().toString();

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    let params = await prisma.paieParameters.findFirst({
      where: { tenantId, annee: parseInt(year) },
    });

    if (!params) {
      // Create default parameters
      params = await prisma.paieParameters.create({
        data: {
          tenantId,
          annee: parseInt(year),
        },
      });
    }

    return NextResponse.json(params);
  } catch (error) {
    console.error("Error fetching paie parameters:", error);
    return NextResponse.json({ error: "Failed to fetch parameters" }, { status: 500 });
  }
}

// PUT /api/hr/paie/parameters - Update parameters
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { tenantId: requestedTenantId, ...updateData } = body;
    const ctx = await requireTenant(req, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    const params = await prisma.paieParameters.create({
      data: {
        ...stripUnsafeUpdateFields(updateData),
        tenantId,
      },
    });

    return NextResponse.json(params);
  } catch (error) {
    console.error("Error updating paie parameters:", error);
    return NextResponse.json({ error: "Failed to update parameters" }, { status: 500 });
  }
}