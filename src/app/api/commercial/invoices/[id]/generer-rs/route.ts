import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { calculerRS, type BeneficiaryRegime, type ServiceType } from '@/lib/retenue-source';
import { categorieFromMatricule } from '@/lib/tej-generator';

/**
 * POST /api/commercial/invoices/[id]/generer-rs
 *
 * Génère une WithholdingTax depuis une facture existante.
 * Accessible depuis le bouton "Générer RS" dans le détail facture.
 *
 * Body:
 *   serviceType       (optional, défaut = PRESTATION_SERVICE)
 *   beneficiaryRegime (optional : IS_20 | IS_10 | STANDARD | FORFAIT | HOTEL)
 *   periodYear      (optional)
 *   periodMonth     (optional)
 *   notes           (optional)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  try {
    const { id } = await params;
    const body = await req.json();
    const {
      serviceType = 'PRESTATION_SERVICE',
      beneficiaryRegime,
      periodYear = new Date().getFullYear(),
      periodMonth = new Date().getMonth() + 1,
      notes,
    } = body;

    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: { client: true, withholdingTaxes: true },
    });

    if (!invoice) {
      return NextResponse.json({ error: 'Facture non trouvée' }, { status: 404 });
    }

    // Vérifier si RS existe déjà
    if (invoice.withholdingTaxes.length > 0) {
      return NextResponse.json({
        error: 'Une RS existe déjà pour cette facture',
        existingId: invoice.withholdingTaxes[0].id,
        existingStatus: invoice.withholdingTaxes[0].tejStatus,
      }, { status: 409 });
    }

    const client = invoice.client;
    const beneficiaryType =
      client.matriculeFiscal && categorieFromMatricule(client.matriculeFiscal, 'PP') === 'PM'
        ? 'SOCIETE' as const
        : 'INDIVIDU' as const;

    // La retenue s'applique au montant TTC payé (art. 52 Code IRPP/IS, taux 2026)
    const grossAmount = Number(invoice.totalTTC ?? 0);
    const calc = calculerRS({
      montantBrut: grossAmount,
      serviceType: serviceType as ServiceType,
      beneficiaryType,
      regime: (beneficiaryRegime as BeneficiaryRegime) ?? null,
    });
    if (calc.taux === 0) {
      return NextResponse.json({ error: `Pas de retenue à la source : ${calc.label}` }, { status: 400 });
    }
    const rate = calc.taux;
    const taxAmount = calc.montantRS;

    const rs = await prisma.withholdingTax.create({
      data: {
        tenantId: invoice.tenantId,
        invoiceId: invoice.id,
        beneficiaryTin: client.matriculeFiscal ?? undefined,
        beneficiaryName: client.name,
        beneficiaryAddress: [client.address, client.city].filter(Boolean).join(', ') || undefined,
        beneficiaryType,
        beneficiaryRegime: beneficiaryRegime ?? null,
        beneficiaryEmail: client.email ?? null,
        beneficiaryPhone: client.phone ?? null,
        serviceType: serviceType as any,
        serviceDescription: `Facture ${invoice.number} — ${invoice.type}`,
        grossAmount,
        rate,
        taxAmount,
        netAmount: calc.montantNet,
        teeJAmount: calc.montantNet,
        periodYear: Number(periodYear),
        periodMonth: Number(periodMonth),
        tejStatus: 'DRAFT',
        paymentDate: invoice.dueDate ?? invoice.date,
        notes: notes ?? `Retenue à la source — Facture ${invoice.number}`,
      },
    });

    return NextResponse.json({
      message: 'RS créée avec succès',
      withholdingTax: rs,
      summary: {
        facture: invoice.number,
        client: client.name,
        montantTTC: grossAmount.toFixed(3),
        taux: `${(rate * 100).toFixed(2)}%`,
        montantRS: taxAmount.toFixed(3),
        netVerse: calc.montantNet.toFixed(3),
        periode: `${periodMonth}/${periodYear}`,
      },
    }, { status: 201 });

  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
