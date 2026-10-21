/**
 * Situation familiale d'un employé (paie tunisienne) : état civil, chef de famille, enfants à charge.
 * Normalise les saisies libres (formulaire, import CSV/Excel) : « Marié », « mariée », « M », « oui », « 1 »…
 */

export type EtatCivil = 'CELIBATAIRE' | 'MARIE' | 'DIVORCE' | 'VEUF'
export type SituationFamiliale = 'CHEF_FAMILLE' | 'NON_CHEF_FAMILLE'

export const ETATS_CIVILS: EtatCivil[] = ['CELIBATAIRE', 'MARIE', 'DIVORCE', 'VEUF']
export const ETAT_CIVIL_LABELS_FR: Record<EtatCivil, string> = {
  CELIBATAIRE: 'Célibataire',
  MARIE: 'Marié(e)',
  DIVORCE: 'Divorcé(e)',
  VEUF: 'Veuf / veuve',
}

/** Nombre maximal d'enfants saisissable (la déduction IRPP est plafonnée séparément, 4 par défaut). */
export const MAX_CHILDREN_INPUT = 20

const strip = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()

/** État civil depuis une saisie libre ; null si vide ou non reconnu. */
export function parseEtatCivil(v: unknown): EtatCivil | null {
  const s = strip(v).replace(/\(E\)|E$/, '').replace(/[^A-Z]/g, '')
  if (!s) return null
  if (['CELIBATAIRE', 'CELIB', 'C', 'SINGLE', 'CELIBATAIR'].includes(s) || s.startsWith('CELIB')) return 'CELIBATAIRE'
  if (['MARIE', 'MARI', 'M', 'MARRIED'].includes(s) || s.startsWith('MARI')) return 'MARIE'
  if (['DIVORCE', 'DIVORC', 'D', 'DIVORCED'].includes(s) || s.startsWith('DIVORC')) return 'DIVORCE'
  if (['VEUF', 'VEUV', 'VEUVE', 'V', 'WIDOWED', 'WIDOW'].includes(s) || s.startsWith('VEU')) return 'VEUF'
  return null
}

/** Chef de famille depuis une saisie libre (oui/non, 1/0, true/false, CHEF_FAMILLE…) ; null si vide ou non reconnu. */
export function parseChefFamille(v: unknown): SituationFamiliale | null {
  if (typeof v === 'boolean') return v ? 'CHEF_FAMILLE' : 'NON_CHEF_FAMILLE'
  const s = strip(v).replace(/[\s-]+/g, '_')
  if (!s) return null
  if (['CHEF_FAMILLE', 'CHEF_DE_FAMILLE', 'CHEF', 'OUI', 'O', 'YES', 'Y', '1', 'TRUE', 'VRAI', 'X'].includes(s)) return 'CHEF_FAMILLE'
  if (['NON_CHEF_FAMILLE', 'NON_CHEF', 'NON', 'N', 'NO', '0', 'FALSE', 'FAUX'].includes(s)) return 'NON_CHEF_FAMILLE'
  return null
}

/** Nombre d'enfants à charge (entier ≥ 0) ; null si invalide. Vide → 0. */
export function parseEnfantsCharge(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return 0
  const n = Number(String(v).replace(',', '.').trim())
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n) || n > MAX_CHILDREN_INPUT) return null
  return n
}

export interface FamilyInput {
  etatCivil?: unknown
  situationFamiliale?: unknown
  /** alias accepté à l'import : « chefFamille » (oui/non) */
  chefFamille?: unknown
  enfantsCharge?: unknown
}

export interface FamilyFields {
  etatCivil: EtatCivil
  situationFamiliale: SituationFamiliale
  enfantsCharge: number
}

/**
 * Champs famille normalisés + erreurs FR. Valeurs absentes → célibataire, non chef de famille, 0 enfant.
 * Une valeur fournie mais non reconnue est une erreur (pas de repli silencieux).
 */
export function normalizeFamily(input: FamilyInput): { value: FamilyFields; errors: string[] } {
  const errors: string[] = []
  const rawEtat = input.etatCivil
  const etat = parseEtatCivil(rawEtat)
  if (etat === null && strip(rawEtat)) errors.push(`État civil « ${String(rawEtat)} » non reconnu (célibataire, marié, divorcé, veuf)`)

  const rawChef = input.situationFamiliale ?? input.chefFamille
  const chef = parseChefFamille(rawChef)
  if (chef === null && strip(rawChef)) errors.push(`Chef de famille « ${String(rawChef)} » non reconnu (oui / non)`)

  const enfants = parseEnfantsCharge(input.enfantsCharge)
  if (enfants === null) errors.push(`Enfants à charge « ${String(input.enfantsCharge)} » invalide (entier de 0 à ${MAX_CHILDREN_INPUT})`)

  return {
    value: {
      etatCivil: etat ?? 'CELIBATAIRE',
      situationFamiliale: chef ?? 'NON_CHEF_FAMILLE',
      enfantsCharge: enfants ?? 0,
    },
    errors,
  }
}
