import { safeErrorResponse } from '@/lib/security/safe-error'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateNoteHonorairesPDF } from '@/lib/note-honoraires';
import { calculateRetenueSource } from '@/lib/fiscal';

/**
 * POST /api/commercial/invoices/[id]/note-honoraires-pdf
 * Body: { tenantId, forfait? }  (forfait = true : émetteur BNC au forfait d'assiette → RS 10 %)
 *
 * Génère un PDF Note d'Honoraires pour une facture de type HONORAIRES.
 * Calcule la retenue à la source sur honoraires : 3 % du TTC (10 % au forfait).
 * Retourne le PDF en attachment.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { tenantId: requestedTenantId, forfait = false } = body;
    const ctx = await requireTenant(req, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId
    if (!tenantId) return NextResponse.json({ error: 'tenantId required' }, { status: 400 });

    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: { client: true, tenant: true, items: true },
    });
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    // Retenue à la source sur honoraires (art. 52 Code IRPP/IS)
    const rsRate = forfait ? 0.10 : 0.03;
    const rsAmount = calculateRetenueSource(Number(invoice.totalTTC), Number(invoice.subtotalHT), !!forfait);
    const irppAmount = 0;

    const items = invoice.items.map((item: any) => ({
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit || 'Unité',
      unitPriceHT: Number(item.unitPriceHT),
      totalHT: Number(item.totalHT),
    }));

    const pdf = generateNoteHonorairesPDF({
      invoiceNumber: invoice.number,
      date: new Date(invoice.date).toISOString().split('T')[0],
      emitterName: invoice.tenant?.name || '',
      emitterMatricule: invoice.tenant?.matriculeFiscal || '',
      emitterAddress: invoice.tenant?.address || '',
      emitterCity: invoice.tenant?.city || '',
      emitterPhone: invoice.tenant?.phone || '',
      clientName: invoice.client?.name || '',
      clientMatricule: invoice.client?.matriculeFiscal || '',
      clientAddress: invoice.client?.address || '',
      clientCity: invoice.client?.city || '',
      items,
      subtotalHT: Number(invoice.subtotalHT),
      totalFodec: Number(invoice.totalFodec),
      totalVAT: Number(invoice.totalVAT),
      timbreFiscal: Number(invoice.timbreFiscal ?? 1),
      totalTTC: Number(invoice.totalTTC),
      rsAmount,
      rsRate,
      irppAmount,
      notes: invoice.notes || undefined,
    });

    const buffer = Buffer.from(pdf.output('arraybuffer'));
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Note_Honoraires_${invoice.number}.pdf"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (e: any) {
    return safeErrorResponse(e, 'note-honoraires-pdf', 'Génération de la note d’honoraires impossible');
  }
}
