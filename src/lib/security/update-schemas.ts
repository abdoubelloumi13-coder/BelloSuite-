/**
 * Listes blanches des mises à jour (audit E1/E2 : affectation de masse).
 * Aucun champ de rattachement (tenantId, employeeId, relations imbriquées connect/update…) n'est accepté :
 * `.strict()` rejette toute clé inconnue.
 */
import { z } from 'zod'

/**
 * PUT /api/hr/payslips/[id] : seuls le statut et la note sont modifiables.
 * Les montants sont calculés côté serveur (génération de la paie) : pour les corriger, supprimer et régénérer.
 */
export const payslipUpdateSchema = z.object({
  statut: z.enum(['PENDING', 'PAID', 'CANCELLED']).optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict()

export type PayslipUpdate = z.infer<typeof payslipUpdateSchema>

/** Fiche comptabilisée : ni annulation, ni suppression (contrepasser l'écriture d'abord). */
export function payslipChangeBlocked(
  current: { accountingEntryId: string | null; statut: string },
  change: PayslipUpdate | 'delete'
): string | null {
  if (!current.accountingEntryId) return null
  if (change === 'delete') return 'Fiche de paie comptabilisée : suppression impossible'
  if (change.statut === 'CANCELLED') return 'Fiche de paie comptabilisée : annulation impossible'
  return null
}

const qty = z.union([z.number(), z.string()]).transform(v => Number(v)).refine(n => Number.isFinite(n) && n > 0 && n < 1e9, {
  message: 'Quantité invalide',
})

/** PUT /api/gpao/boms/[id] */
export const bomUpdateSchema = z.object({
  tenantId: z.string().optional().nullable(), // seulement comparé à la session (requireTenant)
  productId: z.string().min(1).max(64).optional(),
  version: z.string().trim().min(1).max(32).optional(),
  isActive: z.boolean().optional(),
  items: z.array(z.object({ productId: z.string().min(1).max(64), quantity: qty }).strict()).max(500).optional(),
}).strict()

const optStr = (max: number) => z.string().max(max).nullish()
const optNum = z.union([z.number(), z.string()]).nullish()
  .transform(v => (v === null || v === undefined || v === '' ? null : Number(v)))
  .refine(v => v === null || (Number.isFinite(v) && Math.abs(v) < 1e12), { message: 'Nombre invalide' })

/** POST /api/scan/documents : champs bornés (audit M2) ; clés inconnues ignorées. */
export const scanDocumentCreateSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileType: z.string().trim().min(1).max(100),
  fileSize: z.coerce.number().int().min(0).max(50 * 1024 * 1024),
  fileHash: optStr(128),
  extractedText: z.string().max(200_000).nullish(),
  documentKind: optStr(40),
  supplierName: optStr(255),
  supplierMf: optStr(64),
  reference: optStr(128),
  date: optStr(40),
  totalAmount: optNum,
  currency: optStr(8),
  lines: z.array(z.unknown()).max(1000).nullish(),
  avgConfidence: optNum,
  lowConfidence: z.boolean().nullish(),
  source: optStr(32),
})

export const SCAN_DOCUMENT_MAX_BODY = 1024 * 1024
