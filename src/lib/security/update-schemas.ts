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
