import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";


export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  const accessDenied = requireAccess(ctx, 'hr:write')
  if (accessDenied) return accessDenied
  try {
    const body = await req.json();
    const { payslipId, hours, rate } = body;

    if (!payslipId || hours === undefined) {
      return NextResponse.json({ error: "payslipId and hours required" }, { status: 400 });
    }

    const payslip = await prisma.paySlip.findFirst({ where: { id: payslipId, tenantId: ctx.tenantId } });
    if (!payslip) {
      return NextResponse.json({ error: "Payslip not found" }, { status: 404 });
    }

    // SMIG 2025 = 469.4 DT for 176h/month
    const SMIG = 469.4;
    const HOURLY_RATE = SMIG / 176;
    const OVERTIME_MULTIPLIER = rate || 1.25;
    const amount = Number(hours) * HOURLY_RATE * OVERTIME_MULTIPLIER;

    const updated = await prisma.paySlip.update({
      where: { id: payslipId, tenantId: ctx.tenantId },
      data: {
        heuresSupQte: { increment: Number(hours) },
        heuresSupMontant: { increment: amount },
      },
    });

    return NextResponse.json({ data: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
