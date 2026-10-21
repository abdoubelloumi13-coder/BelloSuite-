/**
 * Traduction des réponses d'erreur API en messages de formulaire (bannière + erreurs par champ), en français.
 *
 * Pourquoi : plusieurs formulaires (article, dépôt…) échouaient « sans aucun message » — la réponse
 * non-OK était ignorée, affichée hors écran (bannière en haut d'un long formulaire) ou derrière une
 * modale, et les 403/500 renvoyaient des libellés génériques filtrés. Fonction pure, testée dans
 * __tests__/form-errors.test.ts.
 */

export type ZodLikeIssue = {
  code?: string
  path?: Array<string | number>
  message?: string
  minimum?: number | bigint
  maximum?: number | bigint
  type?: string
  expected?: string
}

export type FormError = { message: string; fields: Record<string, string> }

/** Message français pour une erreur de validation zod (les messages zod par défaut sont en anglais). */
export function zodIssueToFrench(issue: ZodLikeIssue): string {
  const msg = issue.message || ''
  // Message personnalisé déjà en français (ex. « code requis ») : on le garde.
  if (msg && /[àâçéèêëîïôûùüÿœ]|requis|invalide|obligatoire|doit|trop/i.test(msg)) return msg
  switch (issue.code) {
    case 'too_small':
      if (issue.type === 'string') return Number(issue.minimum) <= 1 ? 'Champ obligatoire' : `Au moins ${issue.minimum} caractères`
      if (issue.type === 'array') return 'Au moins un élément requis'
      return `Doit être supérieur ou égal à ${issue.minimum}`
    case 'too_big':
      if (issue.type === 'string') return `${issue.maximum} caractères maximum`
      return `Doit être inférieur ou égal à ${issue.maximum}`
    case 'invalid_type':
      return issue.expected === 'number' ? 'Nombre attendu' : 'Valeur invalide ou manquante'
    case 'invalid_enum_value':
      return 'Valeur non autorisée'
    case 'invalid_string':
      return 'Format invalide'
    default:
      return msg || 'Valeur invalide'
  }
}

/**
 * Construit { message, fields } à partir du statut HTTP et du corps JSON (éventuellement null).
 * `labels` : libellés lisibles des champs (pour la bannière : « Code : Champ obligatoire »).
 */
export function apiFormError(status: number, data: unknown, labels: Record<string, string> = {}): FormError {
  const body = (data && typeof data === 'object' ? data : {}) as { error?: unknown; message?: unknown; details?: unknown; code?: unknown }
  const raw = typeof body.error === 'string' ? body.error
    : (body.error && typeof body.error === 'object' && typeof (body.error as { message?: unknown }).message === 'string')
      ? (body.error as { message: string }).message
      : typeof body.message === 'string' ? body.message : ''

  const fields: Record<string, string> = {}
  if (Array.isArray(body.details)) {
    for (const issue of body.details as ZodLikeIssue[]) {
      const key = Array.isArray(issue?.path) && issue.path.length ? String(issue.path[0]) : ''
      if (!key || key === 'tenantId' || fields[key]) continue
      fields[key] = zodIssueToFrench(issue)
    }
  }

  const fieldList = Object.entries(fields).map(([k, v]) => `${labels[k] || k} : ${v}`).join(' · ')

  if (status === 0) return { message: 'Connexion au serveur impossible. Vérifiez votre réseau puis réessayez.', fields }
  if (status === 401) return { message: 'Votre session a expiré. Reconnectez-vous puis réessayez.', fields }
  if (status === 403) {
    const specific = raw && !/^(forbidden|accès refusé)$/i.test(raw.trim()) ? raw : ''
    return { message: specific || 'Droits insuffisants pour cette action (rôle administrateur requis). Contactez l’administrateur de votre société.', fields }
  }
  if (status === 400 || status === 422) {
    if (fieldList) return { message: `Formulaire invalide — ${fieldList}`, fields }
    return { message: raw && !/^données invalides$/i.test(raw) ? raw : 'Données invalides : vérifiez les champs du formulaire.', fields }
  }
  if (status === 404) return { message: raw && !/^not found$/i.test(raw) ? raw : 'Élément introuvable.', fields }
  if (status === 409) return { message: raw || 'Conflit : cet élément existe déjà.', fields }
  if (status >= 500) {
    if (body.code === 'DB_SCHEMA_DRIFT' && raw) return { message: raw, fields }
    return { message: `Erreur serveur (${status}). L’enregistrement n’a pas été effectué ; réessayez ou contactez le support.`, fields }
  }
  return { message: raw || `Erreur inattendue (${status}).`, fields }
}

/** fetch + lecture JSON tolérante, sans jamais lever : renvoie { ok, status, data }. */
export async function fetchJson<T = unknown>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null }> {
  try {
    const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } })
    let data: unknown = null
    try { data = await res.json() } catch { /* corps vide ou HTML */ }
    return { ok: res.ok, status: res.status, data: data as T }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}
