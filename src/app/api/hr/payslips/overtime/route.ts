import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { computeOvertimeAmount, hourlyRate, payrollParamsFromRecord, roundMillime } from "@/lib/payroll";
import { computeEmployeePayslip, payslipAmounts, payrollErrorMessage } from "@/lib/payroll-payslip";

/**
 * POST /api/hr/payslips/overtime { payslipId, hours, rate? }
 * Heures supplémentaires au taux horaire de l'employé (salaire / heures du régime 48 h déduites du SMIG
 * 2026 : 554,736 DT / 2,667 DT/h ≈ 208 h), jamais inférieur au SMIG horaire paramétré, × majoration
 * (1,25 par défaut ; 1,5 / 1,75 ou 25 / 50 / 75 %). Le bulletin est ensuite entièrement recalculé
 * (CNSS, IRPP, CSS, net) avec les paramètres de paie du tenant.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  const accessDenied = requireAccess(ctx, 'hr:write')
  if (accessDenied) return accessDenied
  try {
    const body = await req.json().catch(() => null);
    const { payslipId, hours, rate } = body ?? {};

    const h = Number(hours);
    if (!payslipId || !Number.isFinite(h) || h <= 0 || h > 200) {
      return NextResponse.json({ error: "Bulletin et nombre d'heures (entre 0 et 200) requis" }, { status: 400 });
    }

    const payslip = await prisma.paySlip.findFirst({ where: { id: payslipId, tenantId: ctx.tenantId }, include: { employee: true } });
    if (!payslip) {
      return NextResponse.json({ error: "Bulletin introuvable" }, { status: 404 });
    }
    if (payslip.statut !== "PENDING" || payslip.accountingEntryId) {
      return NextResponse.json({ error: "Bulletin payé, annulé ou comptabilisé : heures supplémentaires non modifiables" }, { status: 409 });
    }

    let paramsRecord: Record<string, unknown> | null = null;
    try {
      paramsRecord = (await prisma.paieParameters.findUnique({ where: { tenantId: ctx.tenantId } })) as unknown as Record<string, unknown> | null;
    } catch (e) {
      console.warn("Paramètres de paie illisibles, valeurs 2026 par défaut :", e);
    }
    const params = payrollParamsFromRecord(paramsRecord);

    const hourly = hourlyRate(Number(payslip.employee.salary || payslip.salaireBase), params);
    const amount = computeOvertimeAmount(h, Number(rate) || 1.25, hourly);

    const vars = {
      ...payslip,
      heuresSupQte: roundMillime(Number(payslip.heuresSupQte) + h),
      heuresSupMontant: roundMillime(Number(payslip.heuresSupMontant) + amount),
    };
    const computation = computeEmployeePayslip(payslip.employee, params, vars);
    const amounts = payslipAmounts(payslip.employee, computation, vars);

    const updated = await prisma.paySlip.update({
      where: { id: payslip.id },
      data: amounts as any, // TODO prisma generate (css, cnssPatronal)
    });

    return NextResponse.json({ data: updated, overtime: { hours: h, hourlyRate: roundMillime(hourly), amount } });
  } catch (error) {
    console.error("POST /api/hr/payslips/overtime :", error);
    return NextResponse.json({ error: payrollErrorMessage(error, "Ajout des heures supplémentaires impossible") }, { status: 500 });
  }
}
