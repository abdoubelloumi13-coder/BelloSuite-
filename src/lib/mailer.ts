/**
 * Envoi d'email « enfichable », 100 % gratuit :
 *  - smtp   : Gmail (ou tout SMTP) via nodemailer — SMTP_HOST, SMTP_PORT (587 par défaut), SMTP_USER, SMTP_PASS
 *             (Gmail : mot de passe d'application, ~500 emails / jour gratuits)
 *  - resend : Resend (offre gratuite) — RESEND_API_KEY, RESEND_FROM (sinon onboarding@resend.dev,
 *             qui n'envoie qu'à l'adresse du compte Resend tant qu'aucun domaine n'est vérifié)
 *  - none   : aucun fournisseur configuré → rien n'est envoyé (les anomalies restent visibles dans l'application)
 * Choix : MAIL_PROVIDER=smtp|resend|none force un fournisseur ; sinon SMTP s'il est complet, puis Resend, puis none.
 * Expéditeur : MAIL_FROM (ex. "BelloSuite <moncompte@gmail.com>").
 */

export type MailProvider = 'smtp' | 'resend' | 'none'

export interface MailMessage {
  to: string[]
  subject: string
  html: string
  text?: string
}

export interface MailResult {
  provider: MailProvider
  ok: boolean
  id?: string
  error?: string
}

type Env = Record<string, string | undefined>

const smtpConfigured = (env: Env) => !!(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS)
const resendConfigured = (env: Env) => !!env.RESEND_API_KEY

export function selectMailProvider(env: Env = process.env): MailProvider {
  const forced = (env.MAIL_PROVIDER || '').trim().toLowerCase()
  if (forced === 'none') return 'none'
  if (forced === 'smtp') return smtpConfigured(env) ? 'smtp' : 'none'
  if (forced === 'resend') return resendConfigured(env) ? 'resend' : 'none'
  if (smtpConfigured(env)) return 'smtp'
  if (resendConfigured(env)) return 'resend'
  return 'none'
}

export async function sendMail(msg: MailMessage, env: Env = process.env): Promise<MailResult> {
  const provider = selectMailProvider(env)
  const to = [...new Set(msg.to.map(t => t.trim()).filter(Boolean))]
  if (!to.length) return { provider, ok: false, error: 'Aucun destinataire' }
  if (provider === 'none') return { provider, ok: false, error: 'Aucun fournisseur email configuré' }

  try {
    if (provider === 'smtp') {
      const nodemailer = await import('nodemailer')
      const port = parseInt(env.SMTP_PORT || '587', 10)
      const transport = nodemailer.default.createTransport({
        host: env.SMTP_HOST,
        port,
        secure: port === 465,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      })
      const info = await transport.sendMail({
        from: env.MAIL_FROM || `"BelloSuite" <${env.SMTP_USER}>`,
        to: to.join(', '),
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      })
      return { provider, ok: true, id: info.messageId }
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.RESEND_FROM || env.MAIL_FROM || 'BelloSuite <onboarding@resend.dev>',
        to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    })
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!res.ok) return { provider, ok: false, error: data.message || `HTTP ${res.status}` }
    return { provider, ok: true, id: data.id }
  } catch (e) {
    return { provider, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
