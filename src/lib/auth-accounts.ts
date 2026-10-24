/**
 * Comptes de connexion Supabase Auth (serveur uniquement). Le mot de passe n'est jamais stocké côté Prisma.
 * Partagé par le super admin et l'administrateur d'une entreprise.
 */
import { createClient } from '@supabase/supabase-js'

/**
 * Crée le compte d'authentification. Avec SUPABASE_SERVICE_ROLE_KEY : compte confirmé d'office ;
 * sinon signUp classique (l'utilisateur confirme son e-mail selon la configuration Supabase).
 */
export async function createAuthAccount(email: string, password: string): Promise<'created' | 'existing'> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || (!serviceKey && !anonKey)) throw new Error('Supabase non configuré')
  if (serviceKey) {
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (!error) return 'created'
    if (/already|registered|exists/i.test(error.message)) return 'existing'
    throw error
  }
  const client = createClient(url, anonKey!, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signUp({ email, password })
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return 'existing'
    throw error
  }
  // Supabase renvoie un user sans identities quand l'e-mail existe déjà (anti-énumération)
  return data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0 ? 'existing' : 'created'
}

/** Envoie l'e-mail Supabase de réinitialisation (lien vers /{locale}/reset-password). */
export async function sendPasswordResetEmail(email: string, origin: string, locale = 'fr'): Promise<void> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/${locale}/reset-password` })
  if (error) throw error
}

/**
 * Dernières connexions (Supabase Auth) pour une liste d'e-mails. Au mieux : nécessite la clé service,
 * lit au plus 1 000 comptes, et renvoie un objet vide en cas d'échec (jamais bloquant).
 */
export async function lastSignIns(emails: string[]): Promise<Record<string, string | null>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const out: Record<string, string | null> = {}
  if (!url || !serviceKey || emails.length === 0) return out
  try {
    const wanted = new Set(emails.map(e => e.toLowerCase()))
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error || !data) return out
    for (const u of data.users) {
      const e = (u.email || '').toLowerCase()
      if (wanted.has(e)) out[e] = u.last_sign_in_at ?? null
    }
  } catch (e) {
    console.error('[auth-accounts] lecture des dernières connexions impossible', e)
  }
  return out
}

export function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '')
  return configured || new URL(request.url).origin
}
