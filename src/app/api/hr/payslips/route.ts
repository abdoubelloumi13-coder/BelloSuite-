import { requireAccess } from '@/lib/rbac'
import { requireTenant, requireSession } from '@/lib/api-auth'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { calculerImpotTunisie } from "@/lib/fiscal";


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
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
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
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      tenantId: requestedTenantId,
      employeeIds = [],
      month,
      year,
    } = body;
    const ctx = await requireTenant(req, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    const mois = month !== undefined ? month : body.mois;
    const annee = year !== undefined ? year : body.annee;

    if (!tenantId || !employeeIds.length || mois === undefined || !annee) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get paie parameters
    const params = await prisma.paieParameters.findUnique({ where: { tenantId } }) || {} as any;
    const cnrpsSal = Number(params.cnrpsSalarial || 4.75);
    const cnssSal = Number(params.cnssSalarial || 1.5);
    const cnavsSal = Number(params.cnavsSalarial || 3.5);
    const amoSal = Number(params.amoSalarial || 0.75);
    const plafond = Number(params.cnssPlafond || 10000);

    let generatedCount = 0;

    for (const employeeId of employeeIds) {
      const employee = await prisma.employee.findFirst({ where: { id: employeeId, tenantId: ctx.tenantId } });
      if (!employee || !employee.salary || Number(employee.salary) <= 0) continue;

      const salaryBase = Number(employee.salary);
      const joursTravailles = 26;

      const brutGlobal = salaryBase; // Assuming no extra prime for bulk generation

      const cnrpsSalaire = Math.min(brutGlobal, plafond) * (cnrpsSal / 100);
      const cnssSalaire = Math.min(brutGlobal, plafond) * (cnssSal / 100);
      const cnavisSalaire = Math.min(brutGlobal, plafond) * (cnavsSal / 100);
      const amoSalaire = brutGlobal * (amoSal / 100);
      const totalCotisations = cnrpsSalaire + cnssSalaire + cnavisSalaire + amoSalaire;

      const salaireImposable = brutGlobal - cnrpsSalaire - cnssSalaire;
      const deductionChefFam = employee.situationFamiliale === "CHEF_FAMILLE" ? Number(params.deductionChefFamille || 150) : 0;
      const deductionEnfants = Math.min(Number(employee.enfantsCharge || 0), Number(params.enfantsMaxDeductible || 6)) * Number(params.deductionParEnfant || 40);
      const deductionTotale = deductionChefFam + deductionEnfants;
      const taxableIncome = Math.max(0, salaireImposable - deductionTotale);

      const taxableIncomeAnnuel = taxableIncome * 12;
      const { impot: irpp } = calculerImpotTunisie(taxableIncomeAnnuel);

      const netAPayer = Math.max(0, brutGlobal - totalCotisations - irpp);

      const reference = `${["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][mois-1]}-${annee}-${employee.employeeNumber}`;

      // Prevent duplicates
      const existing = await prisma.paySlip.findFirst({
        where: { tenantId, employeeId, mois, annee },
      });

      if (!existing) {
        await prisma.paySlip.create({
          data: {
            tenantId,
            employeeId,
            reference,
            mois,
            annee,
            joursTravailles,
            salaireBase: salaryBase,
            brutGlobal,
            cnrpsSalaire,
            cnssSalaire,
            cnavisSalaire,
            amoSalaire,
            totalCotisations,
            salaireImposable,
            deductionChefFam,
            deductionEnfants,
            irpp,
            netAPayer,
            statut: "PENDING",
            heuresSupQte: 0,
            heuresSupMontant: 0,
            primeAnciennete: 0,
            primeTransport: 0,
            primePanier: 0,
            autresPrimes: 0,
            deductionAbsences: 0,
            deductionRetards: 0,
            autresDeductions: 0,
          },
        });
        generatedCount++;
      }
    }

    return NextResponse.json({ generated: generatedCount }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
