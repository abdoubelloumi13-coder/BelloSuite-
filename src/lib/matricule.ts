/**
 * Identifiants fiscaux tunisiens — module pur (client + serveur).
 * Matricule fiscal : 13 caractères = 7 chiffres + 3 lettres (clé, code TVA, catégorie) + 3 chiffres
 * (établissement). Saisie acceptée avec séparateurs : « 1234567/A/A/M/000 » → « 1234567AAM000 ».
 * CIN : 8 chiffres.
 */

export const MATRICULE_HINT = '13 caractères, ex. 1234567/A/A/M/000'

/** Retire espaces, « / », « . », « - » et passe en majuscules. */
export function normalizeMatricule(v: string | null | undefined): string {
  return (v || '').toUpperCase().replace(/[\s/.\-]/g, '')
}

export function isValidMatricule(v: string | null | undefined): boolean {
  return /^\d{7}[A-Z]{3}\d{3}$/.test(normalizeMatricule(v))
}

export function isValidCin(v: string | null | undefined): boolean {
  return /^\d{8}$/.test((v || '').replace(/\s/g, ''))
}

/**
 * Identifiant fiscal d'un client : matricule normalisé, ou CIN (8 chiffres), sinon la saisie
 * normalisée telle quelle (la validation stricte se fait côté formulaire / contrôle TEIF).
 */
export function normalizeFiscalId(v: string | null | undefined): string {
  const raw = (v || '').trim()
  if (!raw) return ''
  if (isValidCin(raw)) return raw.replace(/\s/g, '')
  return normalizeMatricule(raw)
}

/** RIB tunisien : 20 chiffres (espaces tolérés à la saisie). */
export function normalizeRib(v: string | null | undefined): string {
  return (v || '').replace(/[\s.\-]/g, '')
}

export function isValidRib(v: string | null | undefined): boolean {
  return /^\d{20}$/.test(normalizeRib(v))
}
