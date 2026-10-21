/**
 * Persistance de la simulation de facture électronique (El Fatoora).
 * ====================================================================
 *  - Table "EInvoiceSimulation" (supabase/migrations/20261021100000_einvoice_simulation.sql) :
 *    XML signé, XML validé, référence TTN simulée, QR.
 *  - Colonnes existantes de "Invoice" mises à jour : ttnStatus, ttnReference, ttnQRCode,
 *    ttnSubmittedAt, ttnAcceptedAt (aucune colonne ajoutée).
 *  - Paramètres : Tenant.settings.einvoice (JSON).
 *
 * Accès en SQL paramétré ($queryRaw) : le client Prisma n'a pas besoin d'être régénéré
 * pour ce modèle, et l'absence de la table (script SQL non exécuté) est convertie
 * en erreur métier explicite au lieu d'un 500.
 * ⚠ Mode simulation — non valable fiscalement. Côté serveur uniquement.
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db'
import { BusinessError } from '@/lib/errors'
import type { SignerMode } from './xades-signer'

export const EINVOICE_TABLE_MISSING_MESSAGE =
  'Table EInvoiceSimulation absente. Exécutez le script SQL einvoice_simulation (supabase/migrations/20261021100000_einvoice_simulation.sql) dans Supabase.'

export class EInvoiceTableMissingError extends BusinessError {
  constructor() {
    super(EINVOICE_TABLE_MISSING_MESSAGE, 503, { code: 'EINVOICE_TABLE_MISSING' })
    this.name = 'EInvoiceTableMissingError'
  }
}

/** P2021 (table absente, client Prisma) ou P2010/42P01 (SQL brut : relation inexistante). */
export function isMissingTableError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const err = e as { code?: string; meta?: { code?: string; table?: string; message?: string }; message?: string }
  if (err.code === 'P2021') return true
  if (err.code === 'P2010' && (err.meta?.code === '42P01' || /does not exist|n'existe pas/i.test(err.meta?.message || ''))) return true
  return /relation "?EInvoiceSimulation"? does not exist|table `?[\w.]*EInvoiceSimulation`? does not exist/i.test(err.message || '')
}

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    if (isMissingTableError(e)) throw new EInvoiceTableMissingError()
    throw e
  }
}

export interface EInvoiceSimulationRow {
  id: string
  invoiceId: string
  tenantId: string
  mode: string
  signedXml: string | null
  signedAt: Date | null
  validatedXml: string | null
  referenceTTN: string | null
  qrDataUrl: string | null
  createdAt: Date
  updatedAt: Date
}

export async function getSimulation(tenantId: string, invoiceId: string): Promise<EInvoiceSimulationRow | null> {
  return guard(async () => {
    const rows = await prisma.$queryRaw<EInvoiceSimulationRow[]>`
      SELECT * FROM "EInvoiceSimulation" WHERE "tenantId" = ${tenantId} AND "invoiceId" = ${invoiceId} LIMIT 1`
    return rows[0] ?? null
  })
}

/** Enregistre un TEIF signé (réinitialise toute validation précédente). */
export async function saveSignedXml(p: { tenantId: string; invoiceId: string; mode: SignerMode; signedXml: string; signedAt: Date }) {
  return guard(async () => {
    const rows = await prisma.$queryRaw<EInvoiceSimulationRow[]>`
      INSERT INTO "EInvoiceSimulation" ("id", "invoiceId", "tenantId", "mode", "signedXml", "signedAt", "validatedXml", "referenceTTN", "qrDataUrl", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${p.invoiceId}, ${p.tenantId}, ${p.mode}, ${p.signedXml}, ${p.signedAt}, NULL, NULL, NULL, NOW(), NOW())
      ON CONFLICT ("invoiceId") DO UPDATE SET
        "mode" = EXCLUDED."mode", "signedXml" = EXCLUDED."signedXml", "signedAt" = EXCLUDED."signedAt",
        "validatedXml" = NULL, "referenceTTN" = NULL, "qrDataUrl" = NULL, "updatedAt" = NOW()
      WHERE "EInvoiceSimulation"."tenantId" = ${p.tenantId}
      RETURNING *`
    if (!rows[0]) throw new BusinessError('Facture électronique introuvable pour ce tenant', 404)
    await prisma.invoice.update({
      where: { id: p.invoiceId, tenantId: p.tenantId },
      data: { ttnStatus: 'SIGNED', ttnReference: null, ttnQRCode: null, ttnSubmittedAt: null, ttnAcceptedAt: null, ttnErrorCode: null, ttnErrorMessage: null },
    })
    return rows[0]
  })
}

/** Enregistre le résultat du dépôt simulé (accepté ou rejeté). */
export async function saveSubmission(p: {
  tenantId: string
  invoiceId: string
  submittedAt: Date
  accepted: boolean
  validatedXml?: string
  referenceTTN?: string
  qrDataUrl?: string
  acceptedAt?: Date
  errors?: string[]
}) {
  return guard(async () => {
    if (p.accepted) {
      const rows = await prisma.$queryRaw<EInvoiceSimulationRow[]>`
        UPDATE "EInvoiceSimulation" SET "validatedXml" = ${p.validatedXml ?? null}, "referenceTTN" = ${p.referenceTTN ?? null},
          "qrDataUrl" = ${p.qrDataUrl ?? null}, "updatedAt" = NOW()
        WHERE "tenantId" = ${p.tenantId} AND "invoiceId" = ${p.invoiceId}
        RETURNING *`
      if (!rows[0]) throw new BusinessError('Signez la facture avant de la déposer', 409)
      await prisma.invoice.update({
        where: { id: p.invoiceId, tenantId: p.tenantId },
        data: {
          ttnStatus: 'ACCEPTED', ttnReference: p.referenceTTN, ttnQRCode: p.qrDataUrl,
          ttnSubmittedAt: p.submittedAt, ttnAcceptedAt: p.acceptedAt ?? p.submittedAt, ttnErrorCode: null, ttnErrorMessage: null,
        },
      })
      return rows[0]
    }
    await prisma.invoice.update({
      where: { id: p.invoiceId, tenantId: p.tenantId },
      data: {
        ttnStatus: 'REJECTED', ttnSubmittedAt: p.submittedAt, ttnAcceptedAt: null,
        ttnErrorCode: 'SIMULATION_REJECTED', ttnErrorMessage: (p.errors || []).join(' ; ').slice(0, 2000),
      },
    })
    return null
  })
}

// ─── Paramètres (Tenant.settings.einvoice) ────────────────────────────────────

export type EInvoiceSignatureMode = SignerMode | 'tuntrust'

export interface EInvoiceSettings {
  /** Mode par défaut proposé à la signature. « tuntrust » = réel, pas encore disponible. */
  mode: EInvoiceSignatureMode
  signerName: string
  signerRole: string
  /** Identifiant DigiGo (e-mail) — simulé */
  signerEmail: string
}

export const DEFAULT_EINVOICE_SETTINGS: EInvoiceSettings = {
  mode: 'local',
  signerName: '',
  signerRole: 'Gérant',
  signerEmail: '',
}

export function normalizeEInvoiceSettings(raw: unknown): EInvoiceSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<EInvoiceSettings>
  const mode: EInvoiceSignatureMode = r.mode === 'digigo-mock' ? 'digigo-mock' : 'local' // tuntrust non disponible
  const str = (v: unknown, max: number, dflt: string) => (typeof v === 'string' ? v.trim().slice(0, max) : dflt)
  return {
    mode,
    signerName: str(r.signerName, 120, DEFAULT_EINVOICE_SETTINGS.signerName),
    signerRole: str(r.signerRole, 100, DEFAULT_EINVOICE_SETTINGS.signerRole) || DEFAULT_EINVOICE_SETTINGS.signerRole,
    signerEmail: str(r.signerEmail, 160, DEFAULT_EINVOICE_SETTINGS.signerEmail),
  }
}

export async function getEInvoiceSettings(tenantId: string): Promise<EInvoiceSettings> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  const settings = (tenant?.settings ?? {}) as Record<string, unknown>
  return normalizeEInvoiceSettings(settings.einvoice)
}

export async function saveEInvoiceSettings(tenantId: string, input: unknown): Promise<EInvoiceSettings> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } })
  const settings = { ...((tenant?.settings ?? {}) as Record<string, unknown>) }
  const next = normalizeEInvoiceSettings(input)
  settings.einvoice = next
  await prisma.tenant.update({ where: { id: tenantId }, data: { settings: settings as object } })
  return next
}
