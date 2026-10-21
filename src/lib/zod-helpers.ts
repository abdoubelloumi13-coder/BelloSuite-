import { z } from 'zod'

/**
 * Les formulaires HTML envoient '' pour un champ laissé vide. Pour un champ optionnel,
 * '' (ou des espaces) doit valoir « non renseigné » (null) et non une valeur invalide :
 * `z.string().email()` refusait '' → POST /api/commercial/clients en 400 avec un e-mail vide.
 */
export const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v)

/** Texte optionnel : '' → null, sinon chaîne nettoyée. */
export const optionalText = () =>
  z.preprocess(blankToNull, z.string().trim().nullable().optional())

/** E-mail optionnel : '' → null, sinon e-mail valide. */
export const optionalEmail = (message = 'email invalide') =>
  z.preprocess(blankToNull, z.string().trim().email(message).nullable().optional())

/** Message lisible à partir d'une réponse d'erreur d'API ({ error, details[] }). */
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const d = data as { error?: unknown; message?: unknown; details?: unknown }
  const base = typeof d.error === 'string' && d.error ? d.error : typeof d.message === 'string' && d.message ? d.message : ''
  const issues = Array.isArray(d.details)
    ? d.details
        .map((i: { path?: unknown[]; message?: string }) => {
          const field = Array.isArray(i?.path) && i.path.length ? String(i.path.join('.')) : ''
          return i?.message ? (field ? `${field} : ${i.message}` : i.message) : ''
        })
        .filter(Boolean)
    : []
  if (base && issues.length) return `${base} — ${issues.join(' ; ')}`
  return base || issues.join(' ; ') || fallback
}

/** Lit le corps JSON d'une réponse en erreur et renvoie un message affichable. */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  let data: unknown = null
  try { data = await res.json() } catch { /* corps vide ou non JSON */ }
  return apiErrorMessage(data, `${fallback} (HTTP ${res.status})`)
}
