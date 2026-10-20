/**
 * src/lib/retenue-source.ts
 * ─────────────────────────
 * Calcul de la Retenue à la Source (RS) — taux en vigueur en 2026
 * (art. 52 du Code de l'IRPP et de l'IS, tel que modifié jusqu'à la LF 2026).
 *
 * Paiements à des résidents établis en Tunisie :
 * ┌──────────────────────────────────────────────────────────────┬────────┬──────────────┐
 * │ Nature                                                       │ Taux   │ Code TEJ     │
 * ├──────────────────────────────────────────────────────────────┼────────┼──────────────┤
 * │ Acquisitions biens/services ≥ 1 000 DT TTC — PM à l'IS 20 %  │ 1 %    │ RS7_000002   │
 * │ … PM à l'IS autres taux, personnes physiques, sociétés de    │ 1,5 %  │ RS7_000001   │
 * │   personnes                                                  │        │              │
 * │ … PM à l'IS 10 % ou PP bénéficiant de la déduction des 2/3   │ 0,5 %  │ RS7_000003   │
 * │ Honoraires — PM et BNC au régime réel                        │ 3 %    │ RS2_000002   │
 * │ Honoraires BNC forfait d'assiette, commissions, courtages    │ 10 %   │ RS2_000001   │
 * │ Rémunérations en contrepartie de la performance              │ 10 %   │ RS2_000003   │
 * │ Artistes, créateurs, droits d'auteur                         │ 5 %    │ RS2_000004   │
 * │ Loyers d'immeubles et de fonds de commerce                   │ 10 %   │ RS1_000002   │
 * │ Loyers d'hôtels (PM et PP au régime réel)                    │ 5 %    │ RS1_000001   │
 * │ Revenus de capitaux mobiliers (intérêts)                     │ 20 %   │ RS3_000001   │
 * │ Dividendes versés aux personnes physiques                    │ 10 %   │ RS5_000001   │
 * │ Dividendes versés aux personnes morales                      │ 0 %    │ —            │
 * └──────────────────────────────────────────────────────────────┴────────┴──────────────┘
 *
 * La retenue s'applique au paiement, sur le montant TTC (TVA comprise).
 * Les salaires relèvent du barème IRPP (module Paie) et ne passent pas par ce calcul.
 * Codes d'opération : cahier des charges TEJ « CCT-RS-V2 » (juin 2024), fichier
 * TEJRSCodesOperations_v1.0.xsd. Les libellés RS7 y mentionnent « IS 15 % » : c'est
 * le taux réduit devenu 20 % en 2025 ; le code reste RS7_000002.
 *
 * Sources : finco.tn/blog/retenue-a-la-source-tunisie-2026, bfc.com.tn (juin 2026),
 * jibaya.tn TEJ-CCT-RS-V2.pdf. À revalider à chaque loi de finances.
 */

export type BeneficiaryType = 'INDIVIDU' | 'SOCIETE';
export type ServiceType =
  | 'PRESTATION_SERVICE'
  | 'HONORAIRES'
  | 'LOYERS'
  | 'DIVIDENDES'
  | 'INTERETS'
  | 'ROYALTIES'
  | 'REMUNERATION'
  | 'AUTRE';

/**
 * Régime fiscal du bénéficiaire — détermine le taux pour les acquisitions et les honoraires.
 *  - IS_20      : personne morale à l'IS au taux de 20 %
 *  - IS_10      : personne morale à l'IS 10 %, ou PP bénéficiant de la déduction des 2/3
 *  - STANDARD   : PM à l'IS à un autre taux, PP au régime réel, sociétés de personnes
 *  - FORFAIT    : personne physique au forfait d'assiette (BNC)
 *  - HOTEL      : (loyers uniquement) loyer d'hôtel
 */
export type BeneficiaryRegime = 'IS_20' | 'IS_10' | 'STANDARD' | 'FORFAIT' | 'HOTEL';

export const ACQUISITION_THRESHOLD_TTC = 1000;

export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  PRESTATION_SERVICE: 'Achats de biens et services (≥ 1 000 DT TTC)',
  HONORAIRES: 'Honoraires, commissions, courtages',
  LOYERS: 'Loyers',
  DIVIDENDES: 'Dividendes',
  INTERETS: 'Intérêts (revenus de capitaux mobiliers)',
  ROYALTIES: 'Artistes, créateurs, droits d\u2019auteur',
  REMUNERATION: 'Rémunérations liées à la performance',
  AUTRE: 'Autres acquisitions (≥ 1 000 DT TTC)',
};

export const REGIME_LABELS: Record<BeneficiaryRegime, string> = {
  IS_20: 'Société à l\u2019IS 20 %',
  IS_10: 'Société à l\u2019IS 10 % / déduction des 2/3',
  STANDARD: 'Régime réel / autre taux d\u2019IS',
  FORFAIT: 'Forfait d\u2019assiette (BNC)',
  HOTEL: 'Loyer d\u2019hôtel',
};

/**
 * Taux « par défaut » (régime STANDARD, personne physique) — conservé pour compatibilité.
 * Utiliser getRSRule() pour le taux réel.
 */
export const SERVICE_TYPE_COEFFICIENTS: Record<ServiceType, number> = {
  PRESTATION_SERVICE: 0.015,
  HONORAIRES: 0.03,
  LOYERS: 0.10,
  DIVIDENDES: 0.10,
  INTERETS: 0.20,
  ROYALTIES: 0.05,
  REMUNERATION: 0.10,
  AUTRE: 0.015,
};

export interface RSRule {
  /** Taux décimal (0.015 = 1,5 %) */
  taux: number;
  /** Code d'opération TEJ (attribut IdTypeOperation), null si aucune retenue */
  tejCode: string | null;
  /** Explication courte affichable */
  label: string;
}

/** Régime par défaut quand l'utilisateur ne l'a pas précisé. */
export function defaultRegime(beneficiaryType: BeneficiaryType): BeneficiaryRegime {
  return beneficiaryType === 'SOCIETE' ? 'IS_20' : 'STANDARD';
}

/**
 * Règle de retenue (taux + code TEJ) selon la nature du paiement et le bénéficiaire.
 * `montantTTC` sert au seuil de 1 000 DT des acquisitions (omis = seuil considéré atteint).
 */
export function getRSRule(
  serviceType: ServiceType,
  beneficiaryType: BeneficiaryType,
  regime?: BeneficiaryRegime | null,
  montantTTC?: number,
): RSRule {
  const r = regime ?? defaultRegime(beneficiaryType);
  switch (serviceType) {
    case 'PRESTATION_SERVICE':
    case 'AUTRE': {
      if (montantTTC !== undefined && montantTTC < ACQUISITION_THRESHOLD_TTC) {
        return { taux: 0, tejCode: null, label: 'Moins de 1 000 DT TTC : pas de retenue' };
      }
      if (r === 'IS_20') return { taux: 0.01, tejCode: 'RS7_000002', label: '1 % — société à l\u2019IS 20 %' };
      if (r === 'IS_10') return { taux: 0.005, tejCode: 'RS7_000003', label: '0,5 % — IS 10 % / déduction 2/3' };
      return { taux: 0.015, tejCode: 'RS7_000001', label: '1,5 % — PP, sociétés de personnes, autres taux d\u2019IS' };
    }
    case 'HONORAIRES':
      if (beneficiaryType === 'INDIVIDU' && r === 'FORFAIT') {
        return { taux: 0.10, tejCode: 'RS2_000001', label: '10 % — BNC au forfait, commissions, courtages' };
      }
      return { taux: 0.03, tejCode: 'RS2_000002', label: '3 % — personne morale ou BNC au régime réel' };
    case 'LOYERS':
      if (r === 'HOTEL') return { taux: 0.05, tejCode: 'RS1_000001', label: '5 % — loyer d\u2019hôtel' };
      return { taux: 0.10, tejCode: 'RS1_000002', label: '10 % — loyer d\u2019immeuble ou de fonds de commerce' };
    case 'DIVIDENDES':
      if (beneficiaryType === 'SOCIETE') return { taux: 0, tejCode: null, label: '0 % — dividendes versés à une personne morale' };
      return { taux: 0.10, tejCode: 'RS5_000001', label: '10 % libératoire — personne physique' };
    case 'INTERETS':
      return { taux: 0.20, tejCode: 'RS3_000001', label: '20 % — revenus de capitaux mobiliers' };
    case 'ROYALTIES':
      return { taux: 0.05, tejCode: 'RS2_000004', label: '5 % — artistes, créateurs, droits d\u2019auteur' };
    case 'REMUNERATION':
      return { taux: 0.10, tejCode: 'RS2_000003', label: '10 % — rémunération liée à la performance' };
    default:
      return { taux: 0, tejCode: null, label: '—' };
  }
}

export interface RSInput {
  /** Montant TTC payé (base de la retenue) */
  montantBrut: number;
  serviceType: ServiceType;
  beneficiaryType: BeneficiaryType;
  regime?: BeneficiaryRegime | null;
  /** @deprecated sans effet : l'ancien « abattement 50 % société » n'existe pas en droit tunisien */
  soumisAbattement?: boolean;
}

export interface RSCalculResult {
  taux: number;
  /** @deprecated = taux */
  tauxSociete: number;
  tejCode: string | null;
  label: string;
  montantBrut: number;
  montantRS: number;
  montantNet: number;
  /** @deprecated = montantNet (champ historique conservé pour la base) */
  montantTEEJ: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Calcule la retenue à la source sur un paiement (arrondi au millime). */
export function calculerRS(input: RSInput): RSCalculResult {
  const { montantBrut, serviceType, beneficiaryType, regime } = input;
  const rule = getRSRule(serviceType, beneficiaryType, regime, montantBrut);
  const montantRS = r3(montantBrut * rule.taux);
  const montantNet = r3(montantBrut - montantRS);
  return {
    taux: rule.taux,
    tauxSociete: rule.taux,
    tejCode: rule.tejCode,
    label: rule.label,
    montantBrut,
    montantRS,
    montantNet,
    montantTEEJ: montantNet,
  };
}

/** Taux affichable, ex. « 1,5 % ». */
export function getTauxDisplay(
  serviceType: ServiceType,
  beneficiaryType: BeneficiaryType,
  regime?: BeneficiaryRegime | null,
): string {
  const { taux } = getRSRule(serviceType, beneficiaryType, regime);
  return `${(taux * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}

/**
 * Matricule fiscal tunisien : 7 chiffres + lettre clé, éventuellement suivis de
 * code TVA / catégorie / établissement (ex. 1234567A, 1234567A/M/A/000, 1234567AMA000).
 */
export function isValidMatriculeFiscal(matricule: string): boolean {
  const m = (matricule || '').toUpperCase().replace(/[\s/.\-]/g, '');
  return /^\d{7}[A-Z]([A-Z]{2}\d{3})?$/.test(m);
}

/** Identifiant TEJ du matricule : 7 chiffres + lettre clé (ex. « 1234567A »), ou null. */
export function tejMatricule(matricule: string | null | undefined): string | null {
  const m = (matricule || '').toUpperCase().replace(/[\s/.\-]/g, '');
  const match = m.match(/^(\d{7}[A-Z])/);
  return match ? match[1] : null;
}

/** Vérifie si un numéro de téléphone tunisien est valide. */
export function isValidPhoneTN(phone: string): boolean {
  return /^(?:\+216|00216)?[2-9][0-9]{7}$/.test(phone.replace(/\s/g, ''));
}

/**
 * Référence interne d'un certificat (Ref_certif_chez_declarant).
 * Format: TEJ-{ANNEE}{MOIS}-{MATRICULE}-{SEQUENCE}
 */
export function generateTEJId(tenantMatricule: string, year: number, month: number, sequence: number): string {
  const yyyy = year.toString();
  const mm = month.toString().padStart(2, '0');
  const seq = sequence.toString().padStart(4, '0');
  return `TEJ-${yyyy}${mm}-${tenantMatricule}-${seq}`;
}

/** Période de déclaration TEJ (YYYY-MM). */
export function getPeriodeDeclaration(year: number, month: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}`;
}
