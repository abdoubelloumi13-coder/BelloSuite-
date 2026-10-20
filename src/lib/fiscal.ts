/**
 * Fiscal Utilities for Tunisian Law (Loi 2024)
 */

export const VAT_RATES = [19, 13, 7]
export const FODEC_RATE = 0.01 // 1%
export const FISCAL_STAMP = 1.000 // 1 DT

export interface LineItem {
  quantity: number
  unitPriceHT: number
  discount: number // Percentage (0-100)
  vatRate: number
  fodecApply: boolean
}

export interface CalculatedLine extends LineItem {
  totalHT: number
  fodecAmount: number
  vatAmount: number
  totalTTC: number
}

export interface InvoiceTotals {
  subtotalHT: number
  totalFodec: number
  totalVAT: number
  timbreFiscal: number
  totalTTC: number
  vatSummary: { [rate: number]: { base: number, amount: number } }
}

/**
 * Calculate totals for a single line
 */
export function calculateLine(line: LineItem): CalculatedLine {
  const quantity = Number(line.quantity) || 0
  const unitPriceHT = Number(line.unitPriceHT) || 0
  const discountFactor = 1 - (Number(line.discount) || 0) / 100
  
  // 1. Base HT after discount
  const totalHT = quantity * unitPriceHT * discountFactor
  
  // 2. FODEC (1%) applied on Net HT
  const fodecAmount = line.fodecApply ? totalHT * FODEC_RATE : 0
  
  // 3. VAT Base = Total HT + FODEC
  const vatBase = totalHT + fodecAmount
  const vatAmount = vatBase * (Number(line.vatRate) / 100)
  
  // 4. Line TTC
  const totalTTC = vatBase + vatAmount
  
  return {
    ...line,
    totalHT,
    fodecAmount,
    vatAmount,
    totalTTC
  }
}

/**
 * Calculate grand totals for an invoice
 */
export function calculateInvoiceTotals(lines: LineItem[]): InvoiceTotals {
  const calculatedLines = lines.map(calculateLine)
  
  let subtotalHT = 0
  let totalFodec = 0
  let totalVAT = 0
  const vatSummary: { [rate: number]: { base: number, amount: number } } = {}

  calculatedLines.forEach(line => {
    subtotalHT += line.totalHT
    totalFodec += line.fodecAmount
    totalVAT += line.vatAmount
    
    const rate = Number(line.vatRate)
    const baseForVat = line.totalHT + line.fodecAmount
    
    if (!vatSummary[rate]) {
      vatSummary[rate] = { base: 0, amount: 0 }
    }
    vatSummary[rate].base += baseForVat
    vatSummary[rate].amount += line.vatAmount
  })

  const totalBeforeStamp = subtotalHT + totalFodec + totalVAT
  
  // Timbre fiscal is applied if TTC > 0 (usually per law, some conditions apply but 1 DT is standard)
  const timbreFiscal = totalBeforeStamp > 0 ? FISCAL_STAMP : 0
  const totalTTC = totalBeforeStamp + timbreFiscal

  return {
    subtotalHT,
    totalFodec,
    totalVAT,
    timbreFiscal,
    totalTTC,
    vatSummary
  }
}

// ============================================================
// RETENUE À LA SOURCE — Honoraires (Tunisie, taux 2026)
// Art. 52 Code IRPP/IS : 3 % (PM et BNC au régime réel), 10 % (BNC au forfait d'assiette),
// appliqués au montant TTC payé. Pas de plafond. Voir src/lib/retenue-source.ts.
// ============================================================

/** Taux RS honoraires — régime réel / personne morale */
export const RS_RATE = 0.03
/** Taux RS honoraires — BNC au forfait d'assiette */
export const RS_RATE_FORFAIT = 0.10

/**
 * Retenue à la source sur des honoraires.
 * @param totalTTC - Montant TTC payé
 * @param _totalHT - conservé pour compatibilité (ignoré)
 * @param forfait  - true si le bénéficiaire est au forfait d'assiette (10 %)
 */
export function calculateRetenueSource(totalTTC: number, _totalHT?: number, forfait = false): number {
  if (totalTTC <= 0) return 0
  return Math.round(totalTTC * (forfait ? RS_RATE_FORFAIT : RS_RATE) * 1000) / 1000
}

/**
 * @deprecated L'« IRPP catégoriel de 15 % sur honoraires » n'existe pas : l'impôt du
 * bénéficiaire est réglé via la retenue à la source puis sa déclaration annuelle.
 * Renvoie toujours 0.
 */
export function calculateIRCPHonitaires(_totalHT: number): number {
  return 0
}

// ============================================================
// IRPP — Impôt sur le Revenu des Personnes Physiques (Tunisie)
// Barème officiel 2024 — revenus annuels
// Source : جدول الضريبة على الدخل
// ============================================================

export type ResultatImpot = {
  impot: number;
  tauxEffectif: number;
};

/**
 * Tranches officielles IRPP Tunisie (revenus annuels en TND).
 * Chaque tranche est définie par son plafond supérieur.
 * Le taux s'applique uniquement sur la partie du revenu
 * qui dépasse le seuil inférieur de la tranche.
 */
const TRANCHES_IRPP = [
  { plafond: 5_000,    taux: 0.00 },
  { plafond: 10_000,   taux: 0.15 },
  { plafond: 20_000,   taux: 0.25 },
  { plafond: 30_000,   taux: 0.30 },
  { plafond: 40_000,   taux: 0.33 },
  { plafond: 50_000,   taux: 0.36 },
  { plafond: 70_000,   taux: 0.38 },
  { plafond: Infinity, taux: 0.40 },
] as const;

const SEUIL_DEBUT_PREMIERE_TRANCHE = 0;

/**
 * Calcule l'IRPP annuel en utilisant le barême progressif tunisien.
 *
 * @param salaireBrutAnnuel — salaire brut annuel en dinars tunisiens (TND)
 * @returns {ResultatImpot} impot (montant total de l'impôt) et tauxEffectif (ratio impot/revenu)
 *
 * @example
 * calculerImpotTunisie(30_000)
 * // { impot: 6_250, tauxEffectif: 0.2083 }
 */
export function calculerImpotTunisie(salaireBrutAnnuel: number): ResultatImpot {
  if (salaireBrutAnnuel <= 0) {
    return { impot: 0, tauxEffectif: 0 };
  }

  let impotTotal = 0;
  let revenuRestant = salaireBrutAnnuel;
  let seuilPrecedent = SEUIL_DEBUT_PREMIERE_TRANCHE;

  for (const tranche of TRANCHES_IRPP) {
    if (revenuRestant <= 0) break;

    // Part du revenu déjà couverte par les tranches précédentes
    const partDejaImployee = seuilPrecedent;

    // Si le revenu ne dépasse pas le début de cette tranche, on passe
    if (salaireBrutAnnuel <= partDejaImployee) break;

    // Revenu taxable dans cette tranche uniquement
    const largeurTranche = tranche.plafond - seuilPrecedent;
    const revenuDansTranche = Math.min(
      revenuRestant,
      Math.max(0, Math.min(salaireBrutAnnuel, tranche.plafond) - seuilPrecedent)
    );

    impotTotal += revenuDansTranche * tranche.taux;
    revenuRestant -= revenuDansTranche;
    seuilPrecedent = tranche.plafond;
  }

  const tauxEffectif = impotTotal / salaireBrutAnnuel;

  return {
    impot: Math.round(impotTotal * 1000) / 1000, // 3 décimales
    tauxEffectif: Math.round(tauxEffectif * 10_000) / 10_000, // 4 décimales (~%)
  };
}
