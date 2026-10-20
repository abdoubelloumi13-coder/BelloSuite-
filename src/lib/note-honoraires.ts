/**
 * src/lib/note-honoraires.ts
 * ──────────────────────────
 * Génère la Note d'Honoraires conforme au modèle tunisien :
 *   - En-tête avec émetteur + client
 *   - Tableau des prestations
 *   - Retenue à la source sur honoraires : 3 % du TTC (10 % au forfait d'assiette)
 *   - Totaux: HT, TTC, RS, Net à payer
 *   - Pied de page avec mentions légales
 *
 * Taux honoraires (LF 2026):
 *   - RS calculée par calculateRetenueSource() (art. 52 Code IRPP/IS)
 *   - Net à payer = TTC - RS
 */

import { jsPDF } from 'jspdf';
import { calculateRetenueSource, calculateIRCPHonitaires } from './fiscal';

export interface NoteHonoraireItem {
  description: string;
  quantity: number;
  unit: string;
  unitPriceHT: number;
  totalHT: number;
}

export interface NoteHonoraireOptions {
  // Numérotation
  invoiceNumber: string;
  date: string; // ISO date YYYY-MM-DD

  // Émetteur
  emitterName: string;
  emitterMatricule: string;
  emitterAddress: string;
  emitterCity: string;
  emitterPhone: string;

  // Client
  clientName: string;
  clientMatricule: string;
  clientAddress: string;
  clientCity: string;

  // Lignes de prestation
  items: NoteHonoraireItem[];

  // Totaux (déjà calculés côté caller pour éviter les divergences)
  subtotalHT: number;     // Somme des totalHT lignes
  totalFodec: number;
  totalVAT: number;       // TVA 19% sur HT
  timbreFiscal: number;   // Timbre fiscal = 1.000 DT
  totalTTC: number;       // HT + FODEC + TVA + Timbre

  // Retenue à la source
  rsAmount: number;       // = calculateRetenueSource(totalTTC)
  /** Taux RS appliqué (0.03 ou 0.10), pour l'affichage */
  rsRate?: number;
  /** @deprecated toujours 0, n'est plus affiché */
  irppAmount?: number;

  // Notes
  notes?: string;
}

function fmt(n: number, dec = 3): string {
  return n.toLocaleString('fr-TN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function dateFR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function generateNoteHonorairesPDF(opts: NoteHonoraireOptions): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 15;
  const contentW = pageW - margin * 2;
  let y = margin;

  // ── Helpers ──────────────────────────────────────────────
  function sectionTitle(text: string) {
    doc.setFontSize(8);
    doc.setTextColor(120, 116, 110); // stone-500
    doc.setFont('helvetica', 'bold');
    doc.text(text.toUpperCase(), margin, y);
    y += 2;
  }

  function drawLine(x1: number, y1: number, x2: number, y2: number) {
    doc.setDrawColor(228, 224, 220);
    doc.setLineWidth(0.3);
    doc.line(x1, y1, x2, y2);
  }

  // ── Header ───────────────────────────────────────────────
  // Background header
  doc.setFillColor(15, 51, 51); // dark-teal
  doc.rect(0, 0, pageW, 45, 'F');

  // Left: Émetteur
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(opts.emitterName, margin, 14);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`MF: ${opts.emitterMatricule}`, margin, 20);
  doc.text(opts.emitterAddress, margin, 25);
  doc.text(`${opts.emitterCity}  |  ${opts.emitterPhone}`, margin, 30);

  // Right: NOTE D'HONORAIRES
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('NOTE D\'HONORAIRES', pageW - margin, 14, { align: 'right' });
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`N°: ${opts.invoiceNumber}`, pageW - margin, 21, { align: 'right' });
  doc.text(`Date: ${dateFR(opts.date)}`, pageW - margin, 27, { align: 'right' });

  // Separator
  doc.setDrawColor(255, 255, 255);
  doc.setLineWidth(0.5);
  doc.line(margin, 37, pageW - margin, 37);
  doc.setFontSize(7);
  doc.text('Document généré par BelloSuite — Module Commercial', pageW / 2, 42, { align: 'center' });

  y = 52;

  // ── Client Block ─────────────────────────────────────────
  sectionTitle('Bénéficiaire des honoraires');
  doc.setTextColor(24, 20, 16);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text(opts.clientName, margin, y); y += 5;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`MF: ${opts.clientMatricule}`, margin, y); y += 4;
  doc.text(`${opts.clientAddress}`, margin, y); y += 4;
  doc.text(opts.clientCity, margin, y); y += 8;

  // ── Prestations Table ────────────────────────────────────
  sectionTitle('Détail des prestations');
  y += 2;

  const colWidths = [contentW * 0.50, 18, 18, 28, 28, 28];
  const cols = ['Désignation', 'Qté', 'Unité', 'P.U HT (DT)', 'Total HT (DT)', 'TVA'];
  const tableX = margin;

  // Table header
  doc.setFillColor(248, 245, 243); // stone-50
  doc.rect(tableX, y, contentW, 8, 'F');
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 96, 92);
  let x = tableX;
  cols.forEach((col, i) => {
    doc.text(col, x + (i === 0 ? 2 : colWidths[i] / 2), y + 5.5, {
      align: i === 0 ? 'left' : 'center',
    });
    x += colWidths[i];
  });
  y += 8;

  // Table rows
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(24, 20, 16);
  doc.setFontSize(8);
  opts.items.forEach((item, idx) => {
    if (y > 250) { doc.addPage(); y = margin; }
    const fill = idx % 2 === 0;
    if (fill) { doc.setFillColor(253, 252, 251); doc.rect(tableX, y, contentW, 7, 'F'); }
    x = tableX;
    const rowData = [
      [item.description, 'left'],
      [String(item.quantity), 'center'],
      [item.unit, 'center'],
      [fmt(item.unitPriceHT), 'center'],
      [fmt(item.totalHT), 'center'],
      ['19%', 'center'],
    ];
    rowData.forEach(([text, align], i) => {
      const xPos = i === 0 ? x + 2 : x + colWidths[i] / 2;
      doc.text(text as string, xPos, y + 5, { align: align as any });
      x += colWidths[i];
    });
    y += 7;
  });

  // ── Totals ────────────────────────────────────────────────
  y += 4;
  drawLine(margin, y, pageW - margin, y);
  y += 4;

  const totalsX = pageW - margin - 70;
  const valX = pageW - margin;
  const labelW = 42;
  const valW = 28;

  function totalRow(label: string, value: string, bold = false, highlight = false) {
    if (bold) {
      if (highlight) {
        doc.setFillColor(204, 251, 241); // teal-100
        doc.rect(totalsX - 2, y - 4, 72, 8, 'F');
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(15, 51, 51);
    } else {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 75, 70);
    }
    doc.text(label, totalsX, y);
    doc.text(value, valX, y, { align: 'right' });
    y += 7;
  }

  totalRow('Total HT', fmt(opts.subtotalHT) + ' DT');
  totalRow('FODEC', fmt(opts.totalFodec) + ' DT');
  totalRow(`TVA 19%`, fmt(opts.totalVAT) + ' DT');
  totalRow('Timbre fiscal', fmt(opts.timbreFiscal) + ' DT');
  totalRow('TOTAL TTC', fmt(opts.totalTTC) + ' DT', true, true);

  y += 2;
  drawLine(totalsX, y, valX, y);
  y += 5;

  // ── Retenue à la Source + IRPP ───────────────────────────
  // Box
  doc.setFillColor(255, 250, 238); // amber-50
  doc.setDrawColor(252, 211, 77);  // amber-300
  doc.setLineWidth(0.5);
  doc.roundedRect(totalsX - 2, y, 72, 12, 2, 2, 'FD');

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(120, 81, 9); // amber-800
  doc.text('RETENUE À LA SOURCE', totalsX, y + 5);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  const rsPct = `${((opts.rsRate ?? 0.03) * 100).toLocaleString('fr-FR')}%`;
  doc.text(`Art. 52 Code IRPP/IS — ${rsPct} du TTC`, totalsX, y + 9);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(`-${fmt(opts.rsAmount)} DT`, valX, y + 7, { align: 'right' });
  y += 12;

  y += 2;

  // Net à payer
  const netAPayer = opts.totalTTC - opts.rsAmount;
  doc.setFillColor(15, 51, 51);
  doc.roundedRect(totalsX - 2, y, 72, 12, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('NET À PAYER', totalsX, y + 5);
  doc.setFontSize(11);
  doc.text(fmt(netAPayer) + ' DT', valX, y + 8, { align: 'right' });
  y += 18;

  // ── Mentions légales ──────────────────────────────────────
  if (y > 255) { doc.addPage(); y = margin; }
  drawLine(margin, y, pageW - margin, y);
  y += 4;
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(140, 135, 130);
  const mentions = [
    'Retenue à la source sur honoraires (art. 52 du Code de l\'IRPP et de l\'IS) : 3% (régime réel, personnes morales) ou 10% (forfait d\'assiette), sur le montant TTC.',
    'Le certificat de retenue est établi par le payeur sur la plateforme TEJ.',
    'Le montant net est à régler par virement bancaire. Merci de mentionner le numéro de la présente note.',
  ];
  mentions.forEach(m => {
    doc.text(`• ${m}`, margin, y);
    y += 4;
  });

  // Footer
  doc.setFontSize(6);
  doc.setTextColor(180, 175, 170);
  doc.text(
    `BelloSuite — ${opts.emitterName} — MF: ${opts.emitterMatricule} — Document généré le ${new Date().toLocaleDateString('fr-TN')}`,
    pageW / 2, 290, { align: 'center' }
  );

  return doc;
}
