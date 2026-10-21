/**
 * TTN / El Fatoora — ASP Integration Service
 * =========================================
 * Submits TEIF invoices through a TTN-approved ASP provider.
 *
 * ⚠️ Les adresses d'API ci-dessous (ttnhub, efacturetn) n'ont PAS été vérifiées auprès
 * des prestataires : elles sont désactivées tant que TTN_ASP_VERIFIED !== 'true'.
 * Le TEIF généré n'est pas signé : un dépôt réel exige la signature XAdES-B (SigFrs)
 * avec un certificat TunTrust, soit chez l'ASP, soit par BelloSuite.
 *
 * Regulatory references:
 *   - LF 2026 Art.53 — mandatory e-invoicing
 *   - Note Commune N°02/2026 — BS → prestations (01/07/2025)
 *   - TTN El Fatoora Spec v2.0
 *   - ANCE/TunTrust digital certificate required
 */

import { generateTEIFXml } from './teif-generator'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ASPProvider = 'ttnhub' | 'efacturetn'

export interface ASPConfig {
  provider: ASPProvider
  apiKey: string
  apiSecret: string
  sftpUsername?: string
  sftpPassword?: string
  sftpEndpoint?: string
  webhookSecret?: string
  isActive: boolean
}

export interface TTNSubmissionResult {
  success: boolean
  ttnReference?: string
  ttnQRCode?: string
  ttnPDFUrl?: string
  ttnXMLSignedUrl?: string
  acceptedAt?: string
  errorCode?: string
  errorMessage?: string
  rawResponse?: any
}

// ─── Provider API clients ──────────────────────────────────────────────────

/** Délai maximal d'un appel prestataire (évite une requête pendante côté UI). */
export const ASP_TIMEOUT_MS = 20_000

/** Dépôt TTN réel via prestataire (ASP) activé ? Sinon seul le flux El Fatoora simulé est proposé. */
export function isAspSubmitEnabled(): boolean {
  return process.env.TTN_ASP_VERIFIED === 'true'
}

async function submitViaTTNHub(config: ASPConfig, teifXml: string, invoiceNumber: string): Promise<TTNSubmissionResult> {
  const res = await fetch(`${'https://api.ttnhub.tn/v1'}/invoices/submit`, {
    signal: AbortSignal.timeout(ASP_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-Api-Secret': config.apiSecret,
    },
    body: JSON.stringify({
      invoiceNumber,
      teifXml,
      mode: 'ASYNC',
      webhookEnabled: !!config.webhookSecret,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return {
      success: false,
      errorCode: String(res.status),
      errorMessage: err.message || `HTTP ${res.status}`,
    }
  }

  const data = await res.json()
  return {
    success: true,
    ttnReference: data.referenceNumber || data.ttnReference || data.id,
    ttnQRCode: data.qrCode || data.qrCodeUrl,
    ttnPDFUrl: data.signedPdfUrl || data.pdfUrl,
    ttnXMLSignedUrl: data.signedXmlUrl || data.xmlUrl,
    acceptedAt: data.acceptedAt || data.timestamp,
    rawResponse: data,
  }
}

async function submitViaEFactureTN(config: ASPConfig, teifXml: string, invoiceNumber: string): Promise<TTNSubmissionResult> {
  const res = await fetch(`${'https://api.efacturetn.com/v1'}/invoices`, {
    signal: AbortSignal.timeout(ASP_TIMEOUT_MS),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': config.apiKey,
      'X-API-Secret': config.apiSecret,
    },
    body: JSON.stringify({
      reference: invoiceNumber,
      content: teifXml,
      format: 'TEIF',
      asyncMode: true,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return {
      success: false,
      errorCode: String(res.status),
      errorMessage: err.error || err.message || `HTTP ${res.status}`,
    }
  }

  const data = await res.json()
  return {
    success: true,
    ttnReference: data.submissionId || data.reference || data.id,
    ttnQRCode: data.qrCode,
    ttnPDFUrl: data.pdfUrl,
    ttnXMLSignedUrl: data.signedXml,
    acceptedAt: data.timestamp,
    rawResponse: data,
  }
}

// ─── Main submit function ──────────────────────────────────────────────────

export async function submitToTTN(
  invoice: any,   // full Prisma Invoice with items, client, tenant
  config: ASPConfig
): Promise<TTNSubmissionResult> {
  if (!config?.isActive) {
    return { success: false, errorCode: 'CONFIG_DISABLED', errorMessage: 'ASP configuration is not active' }
  }

  if (!isAspSubmitEnabled()) {
    return {
      success: false,
      errorCode: 'ASP_NOT_VERIFIED',
      errorMessage: "Dépôt TTN désactivé : intégration prestataire non vérifiée. Exportez le TEIF et déposez-le via votre prestataire ou El Fatoora.",
    }
  }

  // Generate TEIF XML
  let teifXml: string
  try {
  teifXml = generateTEIFXml({
    invoiceNumber: invoice.number,
    type: invoice.type,
    issueDate: new Date(invoice.date).toISOString().split('T')[0],
    dueDate: invoice.dueDate ? new Date(invoice.dueDate).toISOString().split('T')[0] : undefined,
    tenant: {
      name: invoice.tenant?.name || '',
      matriculeFiscal: invoice.tenant?.matriculeFiscal || '',
      address: invoice.tenant?.address || '',
      city: invoice.tenant?.city || '',
      zipCode: invoice.tenant?.zipCode || '',
      phone: invoice.tenant?.phone || '',
    },
    client: {
      name: invoice.client?.name || '',
      matriculeFiscal: invoice.client?.matriculeFiscal || '',
      address: invoice.client?.address || '',
      city: invoice.client?.city || '',
    },
    items: invoice.items,
    totals: {
      subtotalHT: Number(invoice.subtotalHT),
      totalFodec: Number(invoice.totalFodec),
      totalVAT: Number(invoice.totalVAT),
      timbreFiscal: Number(invoice.timbreFiscal || 1),
      totalTTC: Number(invoice.totalTTC),
      vatSummary: invoice.vatSummary || {},
    },
  })
  } catch (e: any) {
    return { success: false, errorCode: 'TEIF_INVALID', errorMessage: e?.message || 'TEIF invalide' }
  }

  // Submit based on provider (délai maximal : ASP_TIMEOUT_MS)
  try {
    switch (config.provider) {
      case 'ttnhub':
        return await submitViaTTNHub(config, teifXml, invoice.number)
      case 'efacturetn':
        return await submitViaEFactureTN(config, teifXml, invoice.number)
      default:
        return { success: false, errorCode: 'UNKNOWN_PROVIDER', errorMessage: `Provider ${config.provider} not supported` }
    }
  } catch (e: any) {
    const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError'
    return {
      success: false,
      errorCode: timeout ? 'ASP_TIMEOUT' : 'ASP_UNREACHABLE',
      errorMessage: timeout
        ? `Le prestataire TTN n'a pas répondu en ${ASP_TIMEOUT_MS / 1000} s. Réessayez plus tard.`
        : `Prestataire TTN injoignable : ${e?.message || 'erreur réseau'}`,
    }
  }
}

// ─── Test connection ───────────────────────────────────────────────────────

export async function testASPConnection(config: ASPConfig): Promise<{ ok: boolean; message: string }> {
  if (!config?.provider || !config?.apiKey) {
    return { ok: false, message: 'Provider or API key missing' }
  }

  try {
    const baseUrl = config.provider === 'ttnhub'
      ? 'https://api.ttnhub.tn/v1'
      : 'https://api.efacturetn.com/v1'

    const res = await fetch(`${baseUrl}/ping`, {
      signal: AbortSignal.timeout(ASP_TIMEOUT_MS),
      method: 'GET',
      headers: config.provider === 'ttnhub'
        ? { 'Authorization': `Bearer ${config.apiKey}` }
        : { 'X-API-Key': config.apiKey },
    })

    if (res.ok) return { ok: true, message: `${config.provider} connection OK` }
    return { ok: false, message: `HTTP ${res.status}` }
  } catch (e: any) {
    return { ok: false, message: e.message }
  }
}
