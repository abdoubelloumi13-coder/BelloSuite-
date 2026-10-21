/**
 * Orchestration de la facture électronique SIMULÉE (El Fatoora) pour une facture BelloSuite :
 * TEIF non signé → signature XAdES-B (clé de test locale | DigiGo simulé) → dépôt au
 * simulateur TTN → TEIF validé + référence + QR.
 * ⚠ Mode simulation — non valable fiscalement. Côté serveur uniquement.
 */
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import { generateTEIFXml, TEIFValidationError } from '@/lib/teif-generator'
import { invoiceToTeifData } from './invoice-teif'
import {
  signTeifXml, LocalTestSigner, DigiGoMockSigner, DigiGoMockError, SIMULATION_LABEL,
  type SignerMode, type XadesSigner,
} from './xades-signer'
import { simulateTtnSubmission } from './ttn-simulator'
import {
  getSimulation, saveSignedXml, saveSubmission, getEInvoiceSettings,
  EInvoiceTableMissingError, EINVOICE_TABLE_MISSING_MESSAGE,
} from './store'

export const DEFAULT_DIGIGO_TEST_EMAIL = 'signature-test@bellosuite.tn'

export type EInvoiceStep = 'teif' | 'signed' | 'submitted' | 'validated' | 'rejected'

async function loadInvoice(tenantId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    include: { client: true, items: true, tenant: true },
  })
  if (!invoice) throw new BusinessError('Facture introuvable', 404)
  if (/QUOTE|DEVIS|DELIVERY|ORDER|PROFORMA/i.test(invoice.type || '')) {
    throw new BusinessError('Seules les factures (et avoirs) peuvent être transmises à El Fatoora', 400)
  }
  return invoice
}

/** TEIF 1.8.8 non signé de la facture. */
export async function buildUnsignedTeif(tenantId: string, invoiceId: string): Promise<{ xml: string; number: string }> {
  const invoice = await loadInvoice(tenantId, invoiceId)
  try {
    return { xml: generateTEIFXml(invoiceToTeifData(invoice)), number: invoice.number }
  } catch (e) {
    if (e instanceof TEIFValidationError) throw new BusinessError(e.message, 422, { code: 'TEIF_INVALID', errors: e.errors })
    throw e
  }
}

export interface SignInput {
  mode: SignerMode
  otp?: string
}

export async function signInvoice(tenantId: string, invoiceId: string, input: SignInput) {
  const { xml } = await buildUnsignedTeif(tenantId, invoiceId)
  const settings = await getEInvoiceSettings(tenantId)

  let signer: XadesSigner
  if (input.mode === 'digigo-mock') {
    if (!input.otp || !/^\d{6}$/.test(input.otp)) throw new BusinessError('Code OTP à 6 chiffres requis (DigiGo simulé)', 400, { code: 'OTP_REQUIRED' })
    signer = new DigiGoMockSigner({ email: settings.signerEmail || DEFAULT_DIGIGO_TEST_EMAIL, otp: input.otp })
  } else {
    signer = new LocalTestSigner()
  }

  let result
  try {
    result = await signTeifXml(xml, signer, { claimedRole: settings.signerRole || 'Gérant' })
  } catch (e) {
    if (e instanceof DigiGoMockError) throw new BusinessError(`DigiGo (simulé) : ${e.message}`, 400, { code: e.code })
    throw e
  }
  const signedAt = new Date(result.signingTime)
  await saveSignedXml({ tenantId, invoiceId, mode: result.mode, signedXml: result.xml, signedAt })
  return {
    step: 'signed' as EInvoiceStep,
    mode: result.mode,
    signedAt: signedAt.toISOString(),
    signer: result.signer,
    signerName: settings.signerName || null,
    claimedRole: settings.signerRole || 'Gérant',
    trace: result.trace,
    simulated: true,
    label: SIMULATION_LABEL,
  }
}

export async function submitInvoice(tenantId: string, invoiceId: string) {
  await loadInvoice(tenantId, invoiceId)
  const sim = await getSimulation(tenantId, invoiceId)
  if (!sim?.signedXml) throw new BusinessError('Signez la facture avant de la déposer', 409, { code: 'NOT_SIGNED' })
  if (sim.validatedXml) throw new BusinessError('Facture déjà validée (simulation)', 409, { code: 'ALREADY_VALIDATED', referenceTTN: sim.referenceTTN })

  const submittedAt = new Date()
  const r = await simulateTtnSubmission(sim.signedXml, { now: submittedAt })
  if (!r.accepted) {
    await saveSubmission({ tenantId, invoiceId, submittedAt, accepted: false, errors: r.errors })
    throw new BusinessError('Dépôt rejeté par le simulateur TTN', 422, { code: 'TTN_SIM_REJECTED', errors: r.errors })
  }
  await saveSubmission({
    tenantId, invoiceId, submittedAt, accepted: true,
    validatedXml: r.validatedXml, referenceTTN: r.referenceTTN, qrDataUrl: r.qrDataUrl, acceptedAt: submittedAt,
  })
  return {
    step: 'validated' as EInvoiceStep,
    referenceTTN: r.referenceTTN,
    referenceDate: r.referenceDate,
    validatedAt: r.validatedAt,
    qrDataUrl: r.qrDataUrl,
    qrPayload: r.qrPayload,
    simulated: true,
    label: SIMULATION_LABEL,
  }
}

/** État affiché sur la fiche facture. Ne lève pas si la table manque : renvoie tableMissing. */
export async function getEInvoiceStatus(tenantId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId },
    select: { id: true, ttnStatus: true, ttnReference: true, ttnQRCode: true, ttnSubmittedAt: true, ttnAcceptedAt: true, ttnErrorMessage: true },
  })
  if (!invoice) throw new BusinessError('Facture introuvable', 404)
  let sim = null
  let tableMissing = false
  try {
    sim = await getSimulation(tenantId, invoiceId)
  } catch (e) {
    if (e instanceof EInvoiceTableMissingError) tableMissing = true
    else throw e
  }
  const step: EInvoiceStep = sim?.validatedXml
    ? 'validated'
    : invoice.ttnStatus === 'REJECTED' && sim?.signedXml
      ? 'rejected'
      : sim?.signedXml ? 'signed' : 'teif'
  return {
    step,
    tableMissing,
    tableMissingMessage: tableMissing ? EINVOICE_TABLE_MISSING_MESSAGE : null,
    mode: sim?.mode ?? null,
    signedAt: sim?.signedAt ? new Date(sim.signedAt).toISOString() : null,
    referenceTTN: sim?.referenceTTN ?? null,
    qrDataUrl: sim?.qrDataUrl ?? null,
    submittedAt: invoice.ttnSubmittedAt?.toISOString() ?? null,
    acceptedAt: invoice.ttnAcceptedAt?.toISOString() ?? null,
    errorMessage: step === 'rejected' ? invoice.ttnErrorMessage : null,
    simulated: true,
    label: SIMULATION_LABEL,
  }
}

/** XML à télécharger : non signé, signé (SigFrs) ou validé (RefTtnVal + SigCEv + SigTTN). */
export async function getEInvoiceXml(tenantId: string, invoiceId: string, variant: 'unsigned' | 'signed' | 'validated') {
  if (variant === 'unsigned') {
    const { xml, number } = await buildUnsignedTeif(tenantId, invoiceId)
    return { xml, filename: `${number}_TEIF.xml` }
  }
  const invoice = await loadInvoice(tenantId, invoiceId)
  const sim = await getSimulation(tenantId, invoiceId)
  const xml = variant === 'validated' ? sim?.validatedXml : sim?.signedXml
  if (!xml) {
    throw new BusinessError(variant === 'validated' ? 'Facture pas encore validée (simulation)' : 'Facture pas encore signée', 404)
  }
  const safe = invoice.number.replace(/[^\w.-]+/g, '_')
  return { xml, filename: `${safe}_TEIF_${variant === 'validated' ? 'valide' : 'signe'}_SIMULATION.xml` }
}
