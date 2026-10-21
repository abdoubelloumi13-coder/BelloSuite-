/**
 * Erreurs API côté client : traduction des messages génériques anglais renvoyés par le serveur
 * (« Internal error », « Internal Server Error », « Unauthorized »…) et lecture sûre d'une réponse en échec.
 * Testé dans __tests__/client-errors.test.ts.
 */

export type UiLocale = 'fr' | 'en' | 'ar'

type GenericKey = 'internal' | 'unauthorized' | 'forbidden' | 'not_found' | 'bad_request' | 'missing_fields' | 'too_many' | 'network'

const GENERIC_PATTERNS: Array<[RegExp, GenericKey]> = [
  [/^internal( server)? error\.?$/i, 'internal'],
  [/^something went wrong\.?$/i, 'internal'],
  [/^(unauthori[sz]ed|unauthenticated|not authenticated)\.?$/i, 'unauthorized'],
  [/^(forbidden|access denied)\.?$/i, 'forbidden'],
  [/^not found\.?$/i, 'not_found'],
  [/^(bad request|invalid (request|input|data))\.?$/i, 'bad_request'],
  [/^missing (required )?fields?\.?$/i, 'missing_fields'],
  [/^too many requests\.?$/i, 'too_many'],
  [/^(failed to fetch|network ?error|load failed)\.?$/i, 'network'],
]

const MESSAGES: Record<UiLocale, Record<GenericKey, string>> = {
  fr: {
    internal: 'Erreur interne du serveur. Réessayez dans un instant.',
    unauthorized: 'Session expirée ou non authentifiée. Veuillez vous reconnecter.',
    forbidden: "Vous n'avez pas les droits nécessaires pour cette action.",
    not_found: 'Élément introuvable.',
    bad_request: 'Données invalides. Vérifiez le formulaire.',
    missing_fields: 'Champs obligatoires manquants.',
    too_many: 'Trop de requêtes. Veuillez patienter un instant.',
    network: 'Connexion au serveur impossible. Vérifiez votre connexion internet.',
  },
  en: {
    internal: 'Internal server error. Please try again in a moment.',
    unauthorized: 'Your session has expired. Please sign in again.',
    forbidden: 'You do not have permission to perform this action.',
    not_found: 'Item not found.',
    bad_request: 'Invalid data. Please check the form.',
    missing_fields: 'Required fields are missing.',
    too_many: 'Too many requests. Please wait a moment.',
    network: 'Cannot reach the server. Check your internet connection.',
  },
  ar: {
    internal: 'خطأ داخلي في الخادم. يرجى المحاولة بعد لحظات.',
    unauthorized: 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول من جديد.',
    forbidden: 'ليست لديك الصلاحيات اللازمة لهذا الإجراء.',
    not_found: 'العنصر غير موجود.',
    bad_request: 'بيانات غير صالحة. يرجى التحقق من الاستمارة.',
    missing_fields: 'حقول إلزامية ناقصة.',
    too_many: 'طلبات كثيرة جدًا. يرجى الانتظار قليلًا.',
    network: 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.',
  },
}

const STATUS_FALLBACK: Record<number, GenericKey> = { 400: 'bad_request', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 429: 'too_many' }

export function normalizeLocale(locale?: string | null): UiLocale {
  const l = (locale || '').slice(0, 2).toLowerCase()
  return l === 'en' || l === 'ar' ? l : 'fr'
}

/** Si `msg` est un message générique anglais connu, renvoie sa traduction ; sinon renvoie `msg` inchangé. */
export function translateGenericError(msg: string, locale?: string | null): string {
  const trimmed = (msg || '').trim()
  const hit = GENERIC_PATTERNS.find(([re]) => re.test(trimmed))
  return hit ? MESSAGES[normalizeLocale(locale)][hit[1]] : msg
}

/** true si le message est un générique anglais (à traduire). */
export function isGenericError(msg: unknown): boolean {
  return typeof msg === 'string' && GENERIC_PATTERNS.some(([re]) => re.test(msg.trim()))
}

/** Message générique pour un code HTTP (sans corps exploitable). */
export function messageForStatus(status: number, locale?: string | null): string {
  const key: GenericKey = STATUS_FALLBACK[status] ?? 'internal'
  return MESSAGES[normalizeLocale(locale)][key]
}

/** Message affichable à partir du corps JSON d'une réponse en échec ({ error } ou { message }). */
export function errorFromBody(status: number, data: unknown, locale?: string | null): string {
  const d = data as { error?: unknown; message?: unknown } | null
  const raw = typeof d?.error === 'string' && d.error.trim() ? d.error
    : typeof d?.message === 'string' && d.message.trim() ? d.message
    : undefined
  if (!raw) return messageForStatus(status, locale)
  return translateGenericError(raw, locale)
}

/** Lit une réponse en échec (sans lever) et renvoie un message lisible dans la langue de l'interface. */
export async function readApiError(res: Response, locale?: string | null): Promise<string> {
  let data: unknown = null
  try { data = await res.clone().json() } catch { /* corps non JSON */ }
  return errorFromBody(res.status, data, locale)
}

/** Langue courante de la page (attribut <html lang>), 'fr' par défaut ou hors navigateur. */
export function currentUiLocale(): UiLocale {
  if (typeof document === 'undefined') return 'fr'
  return normalizeLocale(document.documentElement.lang)
}

/**
 * Enveloppe un fetch : pour les appels /api/* en échec dont le corps JSON contient un message générique
 * anglais (error ou message), renvoie une réponse équivalente avec le message traduit. Les autres
 * réponses sont renvoyées telles quelles (aucune lecture du corps).
 */
export function wrapFetchWithErrorTranslation(
  baseFetch: typeof fetch,
  getLocale: () => string | null | undefined = currentUiLocale,
): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await baseFetch(input, init)
    try {
      if (res.ok) return res
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
      if (!/(^|\/\/[^/]+)\/api\//.test(url) && !url.startsWith('/api/')) return res
      if (!(res.headers.get('content-type') || '').includes('application/json')) return res
      const data = await res.clone().json() as Record<string, unknown> | null
      if (!data || typeof data !== 'object') return res
      const field = isGenericError(data.error) ? 'error' : isGenericError(data.message) ? 'message' : null
      if (!field) return res
      const translated = { ...data, [field]: translateGenericError(String(data[field]), getLocale()) }
      const headers = new Headers(res.headers)
      headers.delete('content-length')
      return new Response(JSON.stringify(translated), { status: res.status, statusText: res.statusText, headers })
    } catch {
      return res
    }
  }
  return wrapped as typeof fetch
}
