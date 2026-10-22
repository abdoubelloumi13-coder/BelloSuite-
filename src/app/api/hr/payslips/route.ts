import { requireAccess } from '@/lib/rbac'
import { requireTenant, requireSession } from '@/lib/api-auth'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { payrollParamsFromRecord } from "@/lib/payroll";
import { computeEmployeePayslip, payslipAmounts, payslipReference, payrollErrorMessage } from "@/lib/payroll-payslip";


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
    const year = searchParams.get("year");
    const month = searchParams.get("month");

    if (!tenantId) {
      return NextResponse.json({ error: "Société (tenantId) requise" }, { status: 400 });
    }

    const where: any = { tenantId };
    if (year) where.annee = parseInt(year);
    if (month) where.mois = parseInt(month);

    const payslips = await prisma.paySlip.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            departement: true,
            poste: true,
            salary: true,
          },
        },
      },
      orderBy: [{ annee: "desc" }, { mois: "desc" }],
    });

    return NextResponse.json(payslips);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: payrollErrorMessage(error, "Chargement des bulletins impossible") }, { status: 500 });
  }
}

/**
 * POST /api/hr/payslips — génère (ou recalcule) les bulletins d'une période avec le moteur de paie 2026
 * (lib/payroll : CNSS 9,68 %, frais pro 10 % plafonnés, déductions famille, IRPP barème annuel, CSS 0,5 %).
 * Bulletin existant en brouillon (PENDING, non comptabilisé) → recalculé en conservant ses éléments variables ;
 * bulletin payé, annulé ou comptabilisé → laissé tel quel.
 * Réponse : { generated, updated, skipped: [{ employee, reason }] } ; erreurs en français.
 */
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requête invalide (JSON attendu)" }, { status: 400 });
  }
  const { tenantId: requestedTenantId, employeeIds = [], month, year } = body ?? {};
  const ctx = await requireTenant(req, requestedTenantId)
  if (ctx instanceof NextResponse) return ctx
  const accessDenied = requireAccess(ctx, 'hr:write')
  if (accessDenied) return accessDenied
  const tenantId = ctx.tenantId

  const mois = Number(month !== undefined ? month : body.mois);
  const annee = Number(year !== undefined ? year : body.annee);
  if (!Number.isInteger(mois) || mois < 1 || mois > 12 || !Number.isInteger(annee) || annee < 2000 || annee > 2100) {
    return NextResponse.json({ error: "Période invalide : mois (1-12) et année requis" }, { status: 400 });
  }
  if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
    return NextResponse.json({ error: "Aucun employé actif à payer : créez d'abord des employés avec un salaire de base" }, { status: 400 });
  }

  try {
    // Paramètres du tenant ; table/colonnes absentes → barème 2026 par défaut (la génération ne doit pas planter)
    let paramsRecord: Record<string, unknown> | null = null
    try {
      paramsRecord = (await prisma.paieParameters.findUnique({ where: { tenantId } })) as unknown as Record<string, unknown> | null
    } catch (e) {
      console.warn("Paramètres de paie illisibles, valeurs 2026 par défaut :", e)
    }
    const params = payrollParamsFromRecord(paramsRecord)

    const employees = await prisma.employee.findMany({
      where: { tenantId, id: { in: employeeIds.map(String) } },
    });
    const byId = new Map(employees.map((e) => [e.id, e]));

    let generated = 0;
    let updated = 0;
    const skipped: { employee: string; reason: string }[] = [];

    for (const employeeId of employeeIds.map(String)) {
      const employee = byId.get(employeeId);
      if (!employee) { skipped.push({ employee: employeeId, reason: "Employé introuvable" }); continue; }
      const label = `${employee.employeeNumber} ${employee.firstName} ${employee.lastName}`.trim();
      if (!employee.isActive) { skipped.push({ employee: label, reason: "Employé inactif" }); continue; }
      if (!(Number(employee.salary) > 0)) { skipped.push({ employee: label, reason: "Salaire de base non renseigné" }); continue; }

      const existing = await prisma.paySlip.findFirst({ where: { tenantId, employeeId, mois, annee } });
      if (existing && (existing.statut !== "PENDING" || existing.accountingEntryId)) {
        skipped.push({ employee: label, reason: existing.accountingEntryId ? "Bulletin déjà comptabilisé" : "Bulletin déjà payé ou annulé" });
        continue;
      }

      const vars = existing ?? {};
      const computation = computeEmployeePayslip(employee, params, vars);
      const amounts = payslipAmounts(employee, computation, vars);

      try {
        if (existing) {
          await prisma.paySlip.update({
            where: { id: existing.id },
            data: amounts as any, // TODO prisma generate (css, cnssPatronal)
          });
          updated++;
        } else {
          await prisma.paySlip.create({
            data: {
              tenantId,
              employeeId,
              reference: payslipReference(mois, annee, employee.employeeNumber),
              mois,
              annee,
              joursTravailles: 26,
              statut: "PENDING",
              ...amounts,
            } as any, // TODO prisma generate (css, cnssPatronal)
          });
          generated++;
        }
      } catch (e) {
        console.error(`Bulletin ${label} :`, e);
        // Erreur de schéma (table/colonne) : inutile de continuer, même cause pour tous les employés
        const code = (e as { code?: string })?.code;
        if (code === "P2021" || code === "P2022" || code === "P2011") throw e;
        skipped.push({ employee: label, reason: payrollErrorMessage(e, "Enregistrement impossible") });
      }
    }

    if (generated === 0 && updated === 0) {
      const reasons = skipped.map((s) => `${s.employee} : ${s.reason}`).join(" ; ");
      return NextResponse.json(
        { error: `Aucun bulletin généré${reasons ? ` — ${reasons}` : ""}`, generated, updated, skipped },
        { status: 422 },
      );
    }

    return NextResponse.json({ generated, updated, skipped }, { status: 201 });
  } catch (error) {
    console.error("POST /api/hr/payslips :", error);
    return NextResponse.json({ error: payrollErrorMessage(error) }, { status: 500 });
  }
}
