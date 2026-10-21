import { requireTenant } from '@/lib/api-auth'
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { parseBody } from "@/lib/api";
import { requireAccess } from "@/lib/rbac";
import { payslipUpdateSchema, payslipChangeBlocked } from "@/lib/security/update-schemas";


// GET /api/hr/payslips/[id] - Get single payslip
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  const denied = requireAccess(ctx, 'hr:read')
  if (denied) return denied
  try {
    const { id } = await params;
    const payslip = await prisma.paySlip.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: {
        employee: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            employeeNumber: true,
            departement: true,
            poste: true,
            cin: true,
            hireDate: true,
          },
        },
      },
    });

    if (!payslip) {
      return NextResponse.json({ error: "Fiche de paie introuvable" }, { status: 404 });
    }

    return NextResponse.json(payslip);
  } catch (error) {
    console.error("Error fetching payslip:", error);
    return NextResponse.json({ error: "Lecture de la fiche de paie impossible" }, { status: 500 });
  }
}

// PUT /api/hr/payslips/[id] - Update payslip
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  const deniedW = requireAccess(ctx, 'hr:write')
  if (deniedW) return deniedW
  try {
    const { id } = await params;
    let body: unknown
    try { body = await req.json() } catch { return NextResponse.json({ error: "Body JSON invalide" }, { status: 400 }) }
    // Liste blanche : statut et note uniquement (pas de tenantId/employeeId/relations imbriquées/montants)
    const data = parseBody(payslipUpdateSchema, body)
    if (data instanceof NextResponse) return data

    const current = await prisma.paySlip.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { accountingEntryId: true, statut: true } })
    if (!current) return NextResponse.json({ error: "Fiche de paie introuvable" }, { status: 404 })
    const blocked = payslipChangeBlocked(current, data)
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })

    const payslip = await prisma.paySlip.update({
      where: { id, tenantId: ctx.tenantId },
      data,
    });

    return NextResponse.json(payslip);
  } catch (error) {
    console.error("Error updating payslip:", error);
    return NextResponse.json({ error: "Mise à jour de la fiche de paie impossible" }, { status: 500 });
  }
}

// DELETE /api/hr/payslips/[id] - Delete payslip
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  const denied = requireAccess(ctx, 'hr:write')
  if (denied) return denied
  try {
    const { id } = await params;
    const current = await prisma.paySlip.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { accountingEntryId: true, statut: true } })
    if (!current) return NextResponse.json({ error: "Fiche de paie introuvable" }, { status: 404 })
    const blocked = payslipChangeBlocked(current, 'delete')
    if (blocked) return NextResponse.json({ error: blocked }, { status: 409 })
    await prisma.paySlip.delete({ where: { id, tenantId: ctx.tenantId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting payslip:", error);
    return NextResponse.json({ error: "Suppression de la fiche de paie impossible" }, { status: 500 });
  }
}