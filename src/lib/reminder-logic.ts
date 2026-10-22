/**
 * Relances de paiement — règles pures (testées dans __tests__/reminder-logic.test.ts).
 *
 * Avant : le cron quotidien relançait CHAQUE facture échue, CHAQUE jour, sur TOUS les canaux (e-mail +
 * WhatsApp), y compris quand l'e-mail du client manquait (envoi à l'adresse de la société), et comptait
 * « envoyé » des messages jamais partis (mode démo sans fournisseur).
 */

export type ReminderChannel = 'EMAIL' | 'SMS' | 'WHATSAPP'

/** Intervalle minimal par défaut entre deux relances d'une même facture. */
export const DEFAULT_REMINDER_INTERVAL_DAYS = 7
/** Délai maximal d'un appel fournisseur (e-mail / SMS / WhatsApp). */
export const PROVIDER_TIMEOUT_MS = 10_000

/** Statuts enregistrés dans PaymentReminder.response qui comptent comme « relance faite ». */
export const COUNTED_STATUSES = ['sent', 'delivered', 'simulated'] as const

export function isCountedStatus(s: string | null | undefined): boolean {
  return !!s && (COUNTED_STATUSES as readonly string[]).includes(s)
}

/**
 * Faut-il relancer cette facture maintenant ?
 * - pas avant `intervalDays` jours après la dernière relance comptée (ou Invoice.lastReminderSentAt) ;
 * - jamais avant la prochaine date de relance planifiée (PaymentFollowUp.nextReminderDate).
 */
export function shouldRemind(input: {
  now: Date
  intervalDays?: number
  lastReminderAt?: Date | string | null
  nextReminderDate?: Date | string | null
}): { ok: boolean; reason?: string } {
  const interval = Math.max(1, Number(input.intervalDays) || DEFAULT_REMINDER_INTERVAL_DAYS)
  const now = input.now.getTime()
  if (input.nextReminderDate) {
    const next = new Date(input.nextReminderDate).getTime()
    if (Number.isFinite(next) && next > now) return { ok: false, reason: 'prochaine relance planifiée plus tard' }
  }
  if (input.lastReminderAt) {
    const last = new Date(input.lastReminderAt).getTime()
    if (Number.isFinite(last) && now - last < interval * 86_400_000) return { ok: false, reason: `déjà relancée il y a moins de ${interval} j` }
  }
  return { ok: true }
}

/** Dernière relance comptée parmi l'historique (et lastReminderSentAt). */
export function lastCountedReminder(reminders: Array<{ sentAt: Date | string; response?: string | null }>, lastReminderSentAt?: Date | string | null): Date | null {
  let best: number | null = lastReminderSentAt ? new Date(lastReminderSentAt).getTime() : null
  for (const r of reminders) {
    if (!isCountedStatus(r.response ?? null)) continue
    const t = new Date(r.sentAt).getTime()
    if (Number.isFinite(t) && (best === null || t > best)) best = t
  }
  return best === null || !Number.isFinite(best) ? null : new Date(best)
}

/** Canal joignable pour ce client (e-mail du CLIENT uniquement ; téléphone pour SMS / WhatsApp). */
export function channelAvailable(channel: ReminderChannel, client: { email?: string | null; phone?: string | null }): boolean {
  if (channel === 'EMAIL') return !!client.email && /.+@.+\..+/.test(client.email.trim())
  return !!client.phone && client.phone.replace(/\D/g, '').length >= 8
}

/**
 * Canaux à essayer, dans l'ordre de préférence, limités aux canaux joignables.
 * Un seul envoi réussi par facture : les suivants ne servent que de repli en cas d'échec.
 */
export function orderedChannels(preferred: ReminderChannel[], client: { email?: string | null; phone?: string | null }): ReminderChannel[] {
  const seen = new Set<ReminderChannel>()
  const out: ReminderChannel[] = []
  for (const c of preferred) {
    if (seen.has(c)) continue
    seen.add(c)
    if (channelAvailable(c, client)) out.push(c)
  }
  return out
}

/** fetch avec délai maximal (AbortSignal) : un fournisseur lent ne bloque plus le cron. */
export async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw new Error(`Délai dépassé (${Math.round(timeoutMs / 1000)} s)`)
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Promesse avec délai maximal (SMTP…). */
export async function withTimeout<T>(p: Promise<T>, timeoutMs = PROVIDER_TIMEOUT_MS, label = 'Opération'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const to = new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} : délai dépassé (${Math.round(timeoutMs / 1000)} s)`)), timeoutMs) })
  try { return await Promise.race([p, to]) } finally { if (timer) clearTimeout(timer) }
}
