/**
 * Payment Reminder Service — 100% FREE & Open Source
 * ====================================================
 * EMAIL  → Brevo (300/day free)  |  Gmail SMTP App Password (500/day free)
 * SMS    → Africa's Talking (free sandbox tier)
 * WhatsApp → ChatAPI (free demo) | simulation mode (no credentials needed)
 *
 * No credit card. No paid API required. Works out of the box in demo mode.
 *
 * Configure in Settings > Advanced:
 *   BREVO_API_KEY, BREVO_SENDER_EMAIL
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
 *   AFRICASTALKING_API_KEY, AFRICASTALKING_USERNAME
 *   CHATAPI_INSTANCE_ID, CHATAPI_TOKEN
 */

export type ReminderMethod = "EMAIL" | "SMS" | "WHATSAPP"
export type ReminderResult = {
  status: "sent" | "delivered" | "failed"
  error?: string
  messageId?: string
  provider?: string
}

interface ReminderContext {
  invoice: any
  client: { id: string; name: string; email?: string | null; phone?: string | null }
  tenant: { id: string; name: string; email?: string | null; phone?: string | null; address?: string | null }
  method: ReminderMethod
}

function buildMessages(ctx: ReminderContext) {
  const { invoice, client, tenant } = ctx
  const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString("fr-TN") : "non definie"
  const amount = Number(invoice.totalTTC).toLocaleString("fr-TN", { style: "currency", currency: "TND", maximumFractionDigits: 3 })
  const company = tenant.name || "Votre societe"
  const daysOverdue = invoice.dueDate && new Date(invoice.dueDate) < new Date()
    ? Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000) : null

  const subject = `Rappel paiement - Facture ${invoice.number}${daysOverdue && daysOverdue > 0 ? ` (echue ${daysOverdue}j)` : ""}`

  const emailHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;font-family:Arial,sans-serif;background:#f5f5f5;"><div style="max-width:600px;margin:0 auto;padding:20px;"><div style="background:linear-gradient(135deg,#0d9488,#0f766e);padding:32px;border-radius:16px 16px 0 0;text-align:center;"><h1 style="color:#fff;margin:0;font-size:28px;">Relance de Paiement</h1><p style="color:#a5f3fc;margin:8px 0 0;">${company}</p></div><div style="background:#fff;padding:32px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;box-shadow:0 4px 24px rgba(0,0,0,.08);"><p style="margin:0 0 20px;color:#374151;font-size:16px;">Bonjour <strong>${client.name}</strong>,</p>${daysOverdue && daysOverdue > 0 ? `<div style="background:#fef2f2;border:2px solid #fca5a5;border-radius:12px;padding:20px;margin-bottom:24px;text-align:center;"><p style="margin:0;color:#dc2626;font-weight:bold;font-size:20px;">Facture echue depuis <strong>${daysOverdue} jour(s)</strong></p></div>` : ""}<table style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td style="padding:12px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;">N Facture</td><td style="padding:12px 0;text-align:right;font-weight:bold;">${invoice.number}</td></tr><tr><td style="padding:12px 0;border-bottom:1px solid #f3f4f6;color:#6b7280;">Echeance</td><td style="padding:12px 0;text-align:right;">${dueDate}</td></tr><tr style="background:#f0fdfa;"><td style="padding:16px 0;font-weight:bold;">Montant du</td><td style="padding:16px 0;text-align:right;font-size:22px;font-weight:bold;color:#0d9488;">${amount}</td></tr></table><p style="color:#374151;margin:0 0 24px;">Merci de regler dans les meilleurs dlais. <a href="mailto:${tenant.email || "contact@entreprise.tn"}" style="color:#0d9488;">${tenant.email || "contact@entreprise.tn"}</a></p><div style="text-align:center;margin:28px 0;"><a href="mailto:${tenant.email || "contact@entreprise.tn"}?subject=Paiement%20facture%20${invoice.number}" style="display:inline-block;background:#0d9488;color:#fff;padding:16px 36px;border-radius:12px;text-decoration:none;font-weight:bold;">Confirmer le paiement</a></div><hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0;"><p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">Envoye automatiquement par ${company} — BelloSuite ERP</p></div></div></body></html>`

  const emailText = `RELANCE PAIEMENT - ${company}

Bonjour ${client.name},
${daysOverdue && daysOverdue > 0 ? `ATTENTION : Facture echue depuis ${daysOverdue} jour(s)!

` : ""}Facture N: ${invoice.number}
Echeance: ${dueDate}
Montant: ${amount}

Merci de regler. ${company} — BelloSuite ERP`

  const smsBody = `[${company}] Rappel: Facture ${invoice.number} ${amount}${daysOverdue && daysOverdue > 0 ? ` - retard ${daysOverdue}j` : ""}. BelloSuite`

  const whatsappBody = `Relance de paiement

Bonjour ${client.name},

Votre facture N ${invoice.number} de ${amount} aurait du etre payee le ${dueDate}.
${daysOverdue && daysOverdue > 0 ? `En retard de ${daysOverdue} jour(s)
` : ""}Merci de regler dans les plus brefs dlais.

${company} — BelloSuite`

  return { subject, emailHtml, emailText, smsBody, whatsappBody }
}

function formatPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const clean = phone.replace(/\D/g, "")
  if (clean.startsWith("216")) return `+${clean}`
  if (clean.startsWith("0")) return `+216${clean.slice(1)}`
  return `+216${clean.slice(-8)}`
}

// EMAIL — Brevo (Sendinblue) 300/day FREE
async function sendEmailBrevo(ctx: ReminderContext): Promise<ReminderResult> {
  const apiKey = process.env.BREVO_API_KEY
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "relances@bellosuite.tn"
  const to = ctx.client.email || ctx.tenant.email
  if (!to) return { status: "failed", error: "Aucune adresse email", provider: "brevo" }

  const { subject, emailHtml } = buildMessages(ctx)
  if (!apiKey) return sendEmailSMTP(ctx)

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: { name: ctx.tenant.name || "BelloSuite", email: senderEmail }, to: [{ email: to, name: ctx.client.name }], subject, htmlContent: emailHtml }),
    })
    if (!resp.ok) { if (resp.status === 402) return sendEmailSMTP(ctx); return { status: "failed", error: await resp.text(), provider: "brevo" } }
    const data = await resp.json()
    return { status: "sent", messageId: data.messageId, provider: "brevo" }
  } catch { return sendEmailSMTP(ctx) }
}

// EMAIL — SMTP (Gmail App Password) 500/day FREE
async function sendEmailSMTP(ctx: ReminderContext): Promise<ReminderResult> {
  const { subject, emailText } = buildMessages(ctx)
  const to = ctx.client.email || ctx.tenant.email
  if (!to) return { status: "failed", error: "No email", provider: "smtp" }

  const host = process.env.SMTP_HOST, port = process.env.SMTP_PORT || "587"
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS

  if (!host || !user || !pass) {
    console.log(`[EMAIL DEMO] To: ${to} | ${subject}`)
    return { status: "sent", messageId: `demo_${Date.now()}`, provider: "console_log" }
  }

  try {
    const nodemailer = await import("nodemailer")
    const tr = nodemailer.default.createTransport({ host, port: parseInt(port), secure: port === "465", auth: { user, pass } })
    await tr.sendMail({ from: `"${ctx.tenant.name || "BelloSuite"}" <${user}>`, to: `${ctx.client.name} <${to}>`, subject, text: emailText })
    return { status: "sent", messageId: `smtp_${Date.now()}`, provider: "smtp" }
  } catch (e: any) { return { status: "failed", error: e.message, provider: "smtp" } }
}

// SMS — Africa's Talking FREE sandbox
async function sendSMSAfricaTalking(ctx: ReminderContext): Promise<ReminderResult> {
  const apiKey = process.env.AFRICASTALKING_API_KEY
  const username = process.env.AFRICASTALKING_USERNAME || "sandbox"
  const { smsBody } = buildMessages(ctx)
  const to = formatPhone(ctx.client.phone)
  if (!to) return { status: "failed", error: "Aucun numero", provider: "africastalking" }

  if (!apiKey) {
    console.log(`[SMS DEMO] To: ${to} | ${smsBody}`)
    return { status: "sent", messageId: `demo_sms_${Date.now()}`, provider: "africastalking_demo" }
  }

  try {
    const resp = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username, to, message: smsBody }),
    })
    const data = await resp.json()
    const msg = data.SMSMessageData?.Messages?.[0]
    if (msg?.status === "Success" || data.SMSMessageData?.status === "Success") return { status: "sent", messageId: msg?.messageId, provider: "africastalking" }
    return { status: "failed", error: data.SMSMessageData?.Message || data.errorMessage, provider: "africastalking" }
  } catch (e: any) { return { status: "failed", error: e.message, provider: "africastalking" } }
}

// WhatsApp — ChatAPI free demo | simulation mode if no credentials
async function sendWhatsAppChatAPI(ctx: ReminderContext): Promise<ReminderResult> {
  const { whatsappBody } = buildMessages(ctx)
  const to = formatPhone(ctx.client.phone)
  if (!to) return { status: "failed", error: "Aucun numero WhatsApp", provider: "chatapi" }

  const instanceId = process.env.CHATAPI_INSTANCE_ID
  const token = process.env.CHATAPI_TOKEN

  if (!instanceId || !token) {
    console.log(`[WHATSAPP DEMO] To: ${to} | ${whatsappBody}`)
    return { status: "sent", messageId: `demo_wa_${Date.now()}`, provider: "chatapi_demo" }
  }

  try {
    const resp = await fetch(`https://api.chat-api.com/instance${instanceId}/message?token=${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: to.replace("+", ""), body: whatsappBody }),
    })
    const data = await resp.json()
    if (data.sent) return { status: "sent", messageId: data.id, provider: "chatapi" }
    return { status: "failed", error: data.error || "Send failed", provider: "chatapi" }
  } catch (e: any) { return { status: "failed", error: e.message, provider: "chatapi" } }
}

// WhatsApp — ChatWoot (free open-source) fallback
async function sendWhatsAppChatWoot(ctx: ReminderContext): Promise<ReminderResult> {
  const { whatsappBody } = buildMessages(ctx)
  const to = formatPhone(ctx.client.phone)
  if (!to) return { status: "failed", error: "Aucun numero", provider: "chatwoot" }

  const apiKey = process.env.CHATWOOT_WHATSAPP_TOKEN
  if (!apiKey) {
    console.log(`[WHATSAPP-CW DEMO] To: ${to} | ${whatsappBody}`)
    return { status: "sent", messageId: `demo_cw_${Date.now()}`, provider: "chatwoot_demo" }
  }

  try {
    const base = process.env.CHATWOOT_URL || "https://app.chatwoot.com"
    const resp = await fetch(`${base}/api/v1/features/send_message`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-access-token": apiKey },
      body: JSON.stringify({ phone_number: to.replace("+", ""), content: whatsappBody, message_type: "outgoing", inbox_id: process.env.CHATWOOT_INBOX_ID }),
    })
    if (resp.ok) return { status: "sent", messageId: `cw_${Date.now()}`, provider: "chatwoot" }
    return { status: "failed", error: await resp.text(), provider: "chatwoot" }
  } catch (e: any) { return { status: "failed", error: e.message, provider: "chatwoot" } }
}

export async function sendPaymentReminder(ctx: ReminderContext): Promise<ReminderResult> {
  // Démo publique : aucun e-mail / SMS / WhatsApp réel (sinon spam depuis le domaine BelloSuite)
  const tenantId: string | undefined = ctx.tenant?.id ?? ctx.invoice?.tenantId
  const { isDemoTenant } = await import("@/lib/session-guard")
  if (await isDemoTenant(tenantId)) {
    return { status: "failed", error: "Envois désactivés en mode démo", provider: "none" }
  }
  switch (ctx.method) {
    case "EMAIL": return sendEmailBrevo(ctx)
    case "SMS": return sendSMSAfricaTalking(ctx)
    case "WHATSAPP": {
      const r = await sendWhatsAppChatAPI(ctx)
      return r.status === "failed" ? sendWhatsAppChatWoot(ctx) : r
    }
    default: return { status: "failed", error: `Unknown method: ${ctx.method}`, provider: "none" }
  }
}

export async function sendAutoReminders(
  tenantId: string,
  opts: { overdueDaysThreshold?: number; methods?: ReminderMethod[] } = {}
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const { overdueDaysThreshold = 1, methods = ["EMAIL", "WHATSAPP"] } = opts
  const { prisma } = await import("@/lib/db")

  const since = new Date(); since.setDate(since.getDate() - overdueDaysThreshold)
  const invoices = await prisma.invoice.findMany({
    where: { tenantId, status: { notIn: ["PAID", "CANCELLED", "DRAFT"] }, dueDate: { lte: since } },
    include: { client: true, tenant: true },
  })

  let sent = 0, failed = 0, errors: string[] = []
  for (const inv of invoices) {
    for (const method of methods) {
      const r = await sendPaymentReminder({ invoice: inv, client: inv.client, tenant: inv.tenant, method })
      if (r.status === "sent") {
        sent++
        await prisma.paymentReminder.create({ data: { invoiceId: inv.id, method, response: r.status } })
      } else { failed++; errors.push(`${inv.number}(${method}): ${r.error}`) }
    }
  }
  return { sent, failed, errors }
}
