/**
 * Email matinal « N points à vérifier » (FR / EN / AR selon la langue du tenant) — construction pure, testée.
 * Les textes viennent de messages/*.json (namespace Anomalies) : même source que l'interface.
 */
import fr from '../../messages/fr.json'
import en from '../../messages/en.json'
import ar from '../../messages/ar.json'
import { documentPath, interpolate, type AnomalyParams } from './anomalies'

export type MailLocale = 'fr' | 'en' | 'ar'

type AnomalyMessages = typeof fr.Anomalies
const MESSAGES: Record<MailLocale, AnomalyMessages> = { fr: fr.Anomalies, en: en.Anomalies, ar: ar.Anomalies }

export const DEFAULT_APP_URL = 'https://bellosuite.vercel.app'

export function appBaseUrl(env: Record<string, string | undefined> = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL || env.APP_URL || DEFAULT_APP_URL).replace(/\/+$/, '')
}

/** Langue du tenant : settings.locale (ou settings.language), défaut fr. */
export function tenantLocale(settings: unknown): MailLocale {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {}
  const v = String(s.locale || s.language || 'fr').slice(0, 2).toLowerCase()
  return v === 'en' || v === 'ar' ? v : 'fr'
}

export interface EmailAnomaly {
  type: string
  severity: string
  documentKind: string | null
  documentId: string | null
  details: AnomalyParams | unknown
}

function msgs(locale: MailLocale): AnomalyMessages {
  return MESSAGES[locale] || MESSAGES.fr
}

/** Titre + détail localisés d'une anomalie (le type inconnu retombe sur son code). */
export function describeAnomaly(a: Pick<EmailAnomaly, 'type' | 'details'>, locale: MailLocale): { title: string; detail: string } {
  const types = msgs(locale).types as Record<string, { title: string; detail: string }>
  const t = types[a.type]
  const params = (a.details && typeof a.details === 'object' ? a.details : {}) as AnomalyParams
  if (!t) return { title: a.type, detail: '' }
  return { title: t.title, detail: interpolate(t.detail, params) }
}

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

const SEVERITY_COLOR: Record<string, string> = { CRITICAL: '#b91c1c', HIGH: '#dc2626', MEDIUM: '#d97706', LOW: '#64748b' }

export function buildAnomalyEmail(input: {
  locale: MailLocale
  tenantName: string
  openCount: number
  top: EmailAnomaly[]
  appUrl?: string
}): { subject: string; html: string; text: string } {
  const { locale, tenantName, openCount, top } = input
  const m = msgs(locale)
  const base = input.appUrl ?? appBaseUrl()
  const link = (path: string) => `${base}/${locale}${path}`
  const subject = interpolate(openCount === 1 ? m.email.subject_one : m.email.subject_other, { count: openCount, tenant: tenantName })
  const intro = interpolate(m.email.intro, { count: openCount, tenant: tenantName })
  const items = top.map(a => ({ ...describeAnomaly(a, locale), a, url: link(documentPath(a.documentKind, a.documentId)) }))
  const rest = Math.max(0, openCount - top.length)
  const dir = locale === 'ar' ? 'rtl' : 'ltr'
  const align = locale === 'ar' ? 'right' : 'left'

  const rows = items.map(({ title, detail, a, url }) => `
      <tr><td style="padding:12px 14px;border:1px solid #e7e5e4;border-radius:12px;background:#ffffff">
        <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${SEVERITY_COLOR[a.severity] || '#64748b'}">${esc(String((m.severity as Record<string, string>)[a.severity] || a.severity))}</div>
        <div style="font-size:15px;font-weight:700;color:#1c1917;margin:2px 0 4px">${esc(title)}</div>
        <div style="font-size:13px;color:#57534e;line-height:1.45">${esc(detail)}</div>
        <div style="margin-top:8px"><a href="${esc(url)}" style="font-size:13px;color:#0f766e;font-weight:700;text-decoration:none">${esc(m.email.open)} →</a></div>
      </td></tr><tr><td style="height:8px"></td></tr>`).join('')

  const html = `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;text-align:${align}" dir="${dir}">
      <tr><td style="font-size:22px;font-weight:800;color:#1c1917;padding-bottom:6px">${esc(subject)}</td></tr>
      <tr><td style="font-size:14px;color:#44403c;padding-bottom:14px">${esc(intro)}</td></tr>
      ${items.length ? `<tr><td style="font-size:13px;font-weight:700;color:#78716c;padding-bottom:8px">${esc(m.email.top)}</td></tr>${rows}` : ''}
      ${rest > 0 ? `<tr><td style="font-size:13px;color:#57534e;padding:4px 0 12px">${esc(interpolate(m.email.more, { count: rest }))}</td></tr>` : ''}
      <tr><td style="padding:8px 0 18px"><a href="${esc(link('/anomalies'))}" style="display:inline-block;background:#0f766e;color:#ffffff;font-weight:700;font-size:14px;padding:11px 18px;border-radius:10px;text-decoration:none">${esc(m.email.cta)}</a></td></tr>
      <tr><td style="font-size:11px;color:#a8a29e">${esc(m.email.footer)}</td></tr>
    </table>
  </td></tr></table></body></html>`

  const text = [
    subject, '', intro, '',
    ...(items.length ? [m.email.top, ...items.map(({ title, detail, url }, i) => `${i + 1}. ${title} — ${detail}\n   ${url}`)] : []),
    ...(rest > 0 ? ['', interpolate(m.email.more, { count: rest })] : []),
    '', `${m.email.cta} : ${link('/anomalies')}`, '', m.email.footer,
  ].join('\n')

  return { subject, html, text }
}
