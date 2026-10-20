/**
 * src/lib/tej-generator.ts
 * ──────────────────────
 * Fichier XML de dépôt des certificats de retenue à la source sur la plateforme TEJ
 * (https://tej.finances.gov.tn), conforme au cahier des charges technique
 * « Dépôt de fichier des certificats de retenues à la source » CCT-RS-V2 (juin 2024)
 * et au schéma TEJDeclarationRS_v1.0.xsd.
 *
 * Structure :
 *   <DeclarationsRS VersionSchema="1.0">
 *     <Declarant> TypeIdentifiant=1, Identifiant=7 chiffres+clé, CategorieContribuable=PM|PP
 *     <ReferenceDeclaration> ActeDepot (0 initial / 1 rectificatif), AnneeDepot, MoisDepot
 *     <AjouterCertificats> <Certificat> Beneficiaire, DatePayement (JJ/MM/AAAA),
 *        Ref_certif_chez_declarant, ListeOperations/Operation[@IdTypeOperation], TotalPayement
 *
 * Montants en millimes entiers. Nom de fichier : [MF]-[AAAA]-[MM]-[acte].xml.
 * Le CCT interdit accents, « & », « -- », « /* », commentaires XML : le texte est normalisé.
 */

import { prisma } from '@/lib/db';
import { getRSRule, tejMatricule, type BeneficiaryRegime, type BeneficiaryType, type ServiceType } from './retenue-source';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TEJExportOptions {
  tenantId: string;
  periodYear: number;
  periodMonth: number;
  /** IDs spécifiques à exporter. Défaut = tous DRAFT / EXPORTED de la période */
  withholdingTaxIds?: string[];
  /** 0 = dépôt initial (défaut), 1 = rectificatif */
  acteDepot?: 0 | 1;
}

export type TEJBeneficiaryId =
  | { kind: 'MF'; identifiant: string; categorie: 'PM' | 'PP' }
  | { kind: 'CIN'; identifiant: string; dateNaissance: string };

export interface TEJCertificate {
  ref: string;
  beneficiaire: {
    id: TEJBeneficiaryId;
    resident: boolean;
    nom: string;
    adresse: string;
    activite?: string;
    email: string;
    tel: string;
  };
  /** JJ/MM/AAAA */
  datePayement: string;
  operation: {
    idTypeOperation: string;
    anneeFacturation: number;
    montantHT: number;
    tauxRS: number; // en %, ex. 1.5
    tauxTVA?: number;
    montantTVA?: number;
    montantTTC: number;
    montantRS: number;
    montantNetServi: number;
  };
}

export interface TEJDeclarant {
  identifiant: string; // 7 chiffres + clé
  categorie: 'PM' | 'PP';
}

export interface TEJExportResult {
  xml: string;
  filename: string;
  count: number;
  ids: string[];
  totalRS: number;
  totalBrut: number;
}

/** Ligne d'un enregistrement qui ne peut pas partir dans le fichier, et pourquoi. */
export interface TEJValidationIssue {
  id: string;
  beneficiary: string;
  missing: string[];
}

export class TEJValidationError extends Error {
  issues: TEJValidationIssue[];
  constructor(issues: TEJValidationIssue[]) {
    super(
      'Certificats incomplets pour TEJ : ' +
        issues.map((i) => `${i.beneficiary} (${i.missing.join(', ')})`).join(' ; '),
    );
    this.issues = issues;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Valide un matricule fiscal (7 chiffres + clé, suffixes tolérés). */
export function isValidNOIX(noix: string): boolean {
  return tejMatricule(noix) !== null;
}

/** Normalise un matricule pour TEJ : « 1234567A ». */
export function normalizeNOIX(noix: string): string {
  return tejMatricule(noix) ?? (noix || '').replace(/[\s\-/]/g, '').toUpperCase();
}

/** Catégorie TEJ déduite du code catégorie du matricule (…/M/… = personne morale). */
export function categorieFromMatricule(mf: string | null | undefined, fallback: 'PM' | 'PP' = 'PM'): 'PM' | 'PP' {
  const m = (mf || '').toUpperCase().replace(/[\s/.\-]/g, '');
  const match = m.match(/^\d{7}[A-Z][A-Z]([A-Z])\d{3}$/);
  if (!match) return fallback;
  return match[1] === 'M' ? 'PM' : 'PP';
}

/** Texte compatible CCT : sans accents ni caractères interdits, échappé XML. */
export function tejText(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' et ')
    .replace(/[;*]/g, ' ')
    .replace(/--+/g, '-')
    .replace(/</g, '')
    .replace(/>/g, '')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const toMillimes = (dt: number) => Math.round(dt * 1000);

export function formatDateTEJ(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function rate2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

// ─── Construction du XML ─────────────────────────────────────────────────────

function beneficiaryIdXml(id: TEJBeneficiaryId): string {
  if (id.kind === 'MF') {
    return `<MatriculeFiscal><TypeIdentifiant>1</TypeIdentifiant><Identifiant>${id.identifiant}</Identifiant><CategorieContribuable>${id.categorie}</CategorieContribuable></MatriculeFiscal>`;
  }
  return `<CIN><TypeIdentifiant>2</TypeIdentifiant><Identifiant>${id.identifiant}</Identifiant><DateNaissance>${id.dateNaissance}</DateNaissance><CategorieContribuable>PP</CategorieContribuable></CIN>`;
}

function certificateXml(c: TEJCertificate): string {
  const o = c.operation;
  const b = c.beneficiaire;
  const tva = o.tauxTVA !== undefined && o.montantTVA !== undefined;
  return [
    '    <Certificat>',
    '      <Beneficiaire>',
    `        <IdTaxpayer>${beneficiaryIdXml(b.id)}</IdTaxpayer>`,
    `        <Resident>${b.resident ? 1 : 0}</Resident>`,
    `        <NometprenonOuRaisonsociale>${tejText(b.nom)}</NometprenonOuRaisonsociale>`,
    `        <Adresse>${tejText(b.adresse)}</Adresse>`,
    b.activite ? `        <Activite>${tejText(b.activite)}</Activite>` : '',
    '        <InfosContact>',
    `          <AdresseMail>${b.email.trim()}</AdresseMail>`,
    `          <NumTel>${tejText(b.tel)}</NumTel>`,
    '        </InfosContact>',
    '      </Beneficiaire>',
    `      <DatePayement>${c.datePayement}</DatePayement>`,
    `      <Ref_certif_chez_declarant>${tejText(c.ref)}</Ref_certif_chez_declarant>`,
    '      <ListeOperations>',
    `        <Operation IdTypeOperation="${o.idTypeOperation}">`,
    `          <AnneeFacturation>${o.anneeFacturation}</AnneeFacturation>`,
    '          <CNPC>0</CNPC>',
    '          <P_Charge>0</P_Charge>',
    `          <MontantHT>${toMillimes(o.montantHT)}</MontantHT>`,
    `          <TauxRS>${rate2(o.tauxRS)}</TauxRS>`,
    tva ? `          <TauxTVA>${rate2(o.tauxTVA!)}</TauxTVA>` : '',
    tva ? `          <MontantTVA>${toMillimes(o.montantTVA!)}</MontantTVA>` : '',
    `          <MontantTTC>${toMillimes(o.montantTTC)}</MontantTTC>`,
    `          <MontantRS>${toMillimes(o.montantRS)}</MontantRS>`,
    `          <MontantNetServi>${toMillimes(o.montantNetServi)}</MontantNetServi>`,
    '        </Operation>',
    '      </ListeOperations>',
    '      <TotalPayement>',
    `        <TotalMontantHT>${toMillimes(o.montantHT)}</TotalMontantHT>`,
    tva ? `        <TotalMontantTVA>${toMillimes(o.montantTVA!)}</TotalMontantTVA>` : '',
    `        <TotalMontantTTC>${toMillimes(o.montantTTC)}</TotalMontantTTC>`,
    `        <TotalMontantRS>${toMillimes(o.montantRS)}</TotalMontantRS>`,
    `        <TotalMontantNetServi>${toMillimes(o.montantNetServi)}</TotalMontantNetServi>`,
    '      </TotalPayement>',
    '    </Certificat>',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Génère le XML DeclarationsRS (fonction pure, testable). */
export function generateTEJXml(
  declarant: TEJDeclarant,
  periodYear: number,
  periodMonth: number,
  certificates: TEJCertificate[],
  acteDepot: 0 | 1 = 0,
): string {
  const mm = String(periodMonth).padStart(2, '0');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DeclarationsRS xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="TEJDeclarationRS_v1.0.xsd" VersionSchema="1.0">',
    '  <Declarant>',
    '    <TypeIdentifiant>1</TypeIdentifiant>',
    `    <Identifiant>${declarant.identifiant}</Identifiant>`,
    `    <CategorieContribuable>${declarant.categorie}</CategorieContribuable>`,
    '  </Declarant>',
    '  <ReferenceDeclaration>',
    `    <ActeDepot>${acteDepot}</ActeDepot>`,
    `    <AnneeDepot>${periodYear}</AnneeDepot>`,
    `    <MoisDepot>${mm}</MoisDepot>`,
    '  </ReferenceDeclaration>',
    '  <AjouterCertificats>',
    ...certificates.map(certificateXml),
    '  </AjouterCertificats>',
    '</DeclarationsRS>',
    '',
  ].join('\n');
}

/** Nom de fichier imposé : [MF]-[AAAA]-[MM]-[acte].xml */
export function tejFilename(identifiant: string, year: number, month: number, acte: 0 | 1 = 0): string {
  return `${identifiant}-${year}-${String(month).padStart(2, '0')}-${acte}.xml`;
}

// ─── Conversion record → certificat ──────────────────────────────────────────

const EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

export interface WithholdingRecordLike {
  id: string;
  tejId: string | null;
  beneficiaryTin: string | null;
  beneficiaryName: string;
  beneficiaryAddress: string | null;
  beneficiaryType: string;
  beneficiaryRegime?: string | null;
  beneficiaryEmail?: string | null;
  beneficiaryPhone?: string | null;
  serviceType: string;
  serviceDescription?: string | null;
  grossAmount: unknown;
  vatRate?: unknown;
  taxAmount: unknown;
  rate: unknown;
  paymentDate: Date | null;
  periodYear: number;
  invoice?: { number: string; date: Date; subtotalHT: unknown; totalTTC: unknown } | null;
}

/**
 * Convertit un enregistrement en certificat TEJ. Renvoie la liste des champs manquants
 * au lieu d'inventer des valeurs : TEJ rejette tout fichier incomplet.
 */
export function recordToCertificate(r: WithholdingRecordLike): { cert?: TEJCertificate; missing: string[] } {
  const missing: string[] = [];
  const mf = tejMatricule(r.beneficiaryTin);
  const cin = (r.beneficiaryTin || '').replace(/\D/g, '');
  let id: TEJBeneficiaryId | null = null;
  if (mf) id = { kind: 'MF', identifiant: mf, categorie: categorieFromMatricule(r.beneficiaryTin, r.beneficiaryType === 'SOCIETE' ? 'PM' : 'PP') };
  else if (cin.length === 8) missing.push('date de naissance (bénéficiaire identifié par CIN)');
  else missing.push('matricule fiscal');

  const email = (r.beneficiaryEmail || '').trim();
  if (!EMAIL_RE.test(email)) missing.push('email');
  if (!r.beneficiaryPhone) missing.push('téléphone');
  if (!r.beneficiaryAddress) missing.push('adresse');
  if (!r.paymentDate) missing.push('date de paiement');

  const rule = getRSRule(
    r.serviceType as ServiceType,
    r.beneficiaryType as BeneficiaryType,
    (r.beneficiaryRegime as BeneficiaryRegime) ?? null,
  );
  if (!rule.tejCode) missing.push('nature de paiement sans code TEJ');

  if (missing.length || !id) return { missing };

  const ttc = Number(r.grossAmount);
  let ht = ttc;
  let tauxTVA: number | undefined;
  let montantTVA: number | undefined;
  const vat = r.vatRate !== null && r.vatRate !== undefined ? Number(r.vatRate) : null;
  if (r.invoice && Number(r.invoice.totalTTC) > 0) {
    // Ventilation proportionnelle à la facture liée
    const ratio = Number(r.invoice.subtotalHT) / Number(r.invoice.totalTTC);
    ht = Math.round(ttc * ratio * 1000) / 1000;
    montantTVA = Math.round((ttc - ht) * 1000) / 1000;
    tauxTVA = ht > 0 ? Math.round((montantTVA / ht) * 100) : 0;
  } else if (vat !== null) {
    ht = Math.round((ttc / (1 + vat / 100)) * 1000) / 1000;
    montantTVA = Math.round((ttc - ht) * 1000) / 1000;
    tauxTVA = vat;
  }
  const montantRS = Number(r.taxAmount);
  return {
    missing,
    cert: {
      ref: r.tejId || r.id,
      beneficiaire: {
        id,
        resident: true,
        nom: r.beneficiaryName,
        adresse: r.beneficiaryAddress!,
        activite: r.serviceDescription || undefined,
        email,
        tel: r.beneficiaryPhone!,
      },
      datePayement: formatDateTEJ(r.paymentDate!),
      operation: {
        idTypeOperation: rule.tejCode!,
        anneeFacturation: r.invoice ? r.invoice.date.getUTCFullYear() : r.periodYear,
        montantHT: ht,
        tauxRS: Number(r.rate) * 100,
        tauxTVA,
        montantTVA,
        montantTTC: ttc,
        montantRS,
        montantNetServi: Math.round((ttc - montantRS) * 1000) / 1000,
      },
    },
  };
}

// ─── Export principal ────────────────────────────────────────────────────────

/**
 * Exporte les RS d'une période au format de dépôt TEJ et passe les RS en EXPORTED.
 * @throws TEJValidationError si des certificats sont incomplets (rien n'est exporté).
 */
export async function exportTEJ(options: TEJExportOptions): Promise<TEJExportResult> {
  const { tenantId, periodYear, periodMonth, withholdingTaxIds, acteDepot = 0 } = options;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error('Tenant not found');
  const identifiant = tejMatricule(tenant.matriculeFiscal);
  if (!identifiant) throw new Error('Matricule fiscal de l\'entreprise absent ou invalide (7 chiffres + clé)');

  const where: any = { tenantId, periodYear, periodMonth, tejStatus: { in: ['DRAFT', 'EXPORTED'] } };
  if (withholdingTaxIds?.length) where.id = { in: withholdingTaxIds };

  const records = await prisma.withholdingTax.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: { invoice: { select: { number: true, date: true, subtotalHT: true, totalTTC: true } } },
  });

  if (records.length === 0) {
    throw new Error('Aucune retenue à exporter pour cette période. Vérifiez que des RS sont en statut DRAFT ou EXPORTED.');
  }

  const certificates: TEJCertificate[] = [];
  const issues: TEJValidationIssue[] = [];
  for (const r of records) {
    const { cert, missing } = recordToCertificate(r as unknown as WithholdingRecordLike);
    if (cert) certificates.push(cert);
    else issues.push({ id: r.id, beneficiary: r.beneficiaryName, missing });
  }
  if (issues.length) throw new TEJValidationError(issues);

  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  const categorie =
    settings.tejCategorie === 'PP' || settings.tejCategorie === 'PM'
      ? (settings.tejCategorie as 'PM' | 'PP')
      : categorieFromMatricule(tenant.matriculeFiscal, 'PM');

  const xml = generateTEJXml({ identifiant, categorie }, periodYear, periodMonth, certificates, acteDepot);
  const filename = tejFilename(identifiant, periodYear, periodMonth, acteDepot);
  const ids = records.map((r) => r.id);

  await prisma.withholdingTax.updateMany({
    where: { id: { in: ids }, tenantId },
    data: { tejStatus: 'EXPORTED', exportedAt: new Date() },
  });

  const totalRS = certificates.reduce((s, c) => s + c.operation.montantRS, 0);
  const totalBrut = certificates.reduce((s, c) => s + c.operation.montantTTC, 0);
  return { xml, filename, count: certificates.length, ids, totalRS, totalBrut };
}

// ─── Résumé période ──────────────────────────────────────────────────────────

export interface RSResume {
  totalBrut: number;
  totalRS: number;
  totalNet: number;
  count: number;
  byServiceType: Record<string, { count: number; totalRS: number; totalBrut: number }>;
  byStatus: Record<string, number>;
  byBeneficiaryType: Record<string, { count: number; totalRS: number }>;
}

/**
 * Retourne un résumé détaillé des RS d'une période.
 */
export async function getRSResume(
  tenantId: string,
  periodYear: number,
  periodMonth: number
): Promise<RSResume> {
  const records = await prisma.withholdingTax.findMany({
    where: { tenantId, periodYear, periodMonth },
    include: { invoice: { select: { number: true } } },
  });

  const totalBrut = records.reduce((s, r) => s + Number(r.grossAmount), 0);
  const totalRS = records.reduce((s, r) => s + Number(r.taxAmount), 0);
  const totalNet = records.reduce((s, r) => s + Number(r.netAmount), 0);

  const byServiceType: RSResume['byServiceType'] = {};
  const byStatus: Record<string, number> = {};
  const byBeneficiaryType: RSResume['byBeneficiaryType'] = {};

  for (const r of records) {
    if (!byServiceType[r.serviceType])
      byServiceType[r.serviceType] = { count: 0, totalRS: 0, totalBrut: 0 };
    byServiceType[r.serviceType].count++;
    byServiceType[r.serviceType].totalRS += Number(r.taxAmount);
    byServiceType[r.serviceType].totalBrut += Number(r.grossAmount);

    byStatus[r.tejStatus] = (byStatus[r.tejStatus] || 0) + 1;

    if (!byBeneficiaryType[r.beneficiaryType])
      byBeneficiaryType[r.beneficiaryType] = { count: 0, totalRS: 0 };
    byBeneficiaryType[r.beneficiaryType].count++;
    byBeneficiaryType[r.beneficiaryType].totalRS += Number(r.taxAmount);
  }

  return { totalBrut, totalRS, totalNet, count: records.length, byServiceType, byStatus, byBeneficiaryType };
}

/**
 * Génère un identifiant TEJ unique: TEJ-YYYYMM-MATRICULE-NNNN
 */
export function generateTEJId(matricule: string, year: number, month: number, seq: number): string {
  const mm = String(month).padStart(2, '0');
  const matriculeClean = (matricule || 'XXXXXXXXX').replace(/\D/g, '').slice(0, 9);
  return `TEJ-${year}${mm}-${matriculeClean}-${String(seq).padStart(4, '0')}`;
}
