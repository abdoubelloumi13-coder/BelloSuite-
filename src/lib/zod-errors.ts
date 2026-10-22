/**
 * Erreurs de validation zod → réponse 400 lisible, champ par champ, en français :
 *   { error: "<premier message>", fieldErrors: { "beneficiaryTin": "…", "items.0.quantity": "…" }, details }
 * Remplace le message générique « Données invalides » qui ne disait pas quel champ corriger.
 */
import { NextResponse } from 'next/server'
import type { z, ZodIssue } from 'zod'

const FIELD_LABELS: Record<string, string> = {
  beneficiaryName: 'Nom / raison sociale',
  beneficiaryTin: 'Matricule fiscal',
  beneficiaryType: 'Type de bénéficiaire',
  beneficiaryRegime: 'Régime fiscal',
  beneficiaryEmail: 'E-mail',
  beneficiaryPhone: 'Téléphone',
  beneficiaryAddress: 'Adresse',
  serviceType: 'Nature du paiement',
  grossAmount: 'Montant TTC',
  vatRate: 'Taux de TVA',
  periodMonth: 'Mois',
  periodYear: 'Année',
  paymentDate: 'Date de paiement',
  paymentMethod: 'Mode de paiement',
  clientId: 'Client',
  items: 'Lignes',
  quantity: 'Quantité',
  unitPriceHT: 'Prix unitaire HT',
  discount: 'Remise',
  date: 'Date',
  amount: 'Montant',
  rsAmount: 'Retenue à la source',
  method: 'Mode de règlement',
  vatExemption: 'Régime TVA 0 %',
  vatExemptionRef: 'N° d\'attestation',
}

/** Message français pour les messages zod par défaut (anglais, zod v4). */
function frenchMessage(issue: ZodIssue): string {
  const m = issue.message || ''
  if (!/^(Required|Invalid|Expected|Too (small|big)|String must|Number must|Array must)/i.test(m)) return m
  const i = issue as any
  switch (issue.code) {
    case 'invalid_type':
      return /received (undefined|null)/.test(m) ? 'Champ obligatoire' : 'Valeur invalide'
    case 'invalid_value':
      return 'Valeur non autorisée'
    case 'too_small':
      return i.origin === 'string' ? 'Champ obligatoire' : i.origin === 'array' ? 'Au moins un élément requis' : `Valeur trop petite (minimum ${i.minimum})`
    case 'too_big':
      return i.origin === 'string' ? `Trop long (${i.maximum} caractères maximum)` : `Valeur trop grande (maximum ${i.maximum})`
    case 'invalid_format':
      return i.format === 'email' ? 'Adresse e-mail invalide' : 'Format invalide'
    default:
      return 'Valeur invalide'
  }
}

export function zodFieldErrors(error: z.ZodError): { error: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!fieldErrors[key]) fieldErrors[key] = frenchMessage(issue)
  }
  const [firstKey, firstMsg] = Object.entries(fieldErrors)[0] ?? ['_', 'Données invalides']
  const last = firstKey.split('.').filter(p => !/^\d+$/.test(p)).pop() ?? firstKey
  const line = firstKey.match(/\.(\d+)\./)?.[1]
  const label = FIELD_LABELS[last] ?? (firstKey === '_' ? '' : last)
  const prefix = label ? `${line !== undefined ? `Ligne ${Number(line) + 1} — ` : ''}${label} : ` : ''
  const others = Object.keys(fieldErrors).length - 1
  return {
    error: `${prefix}${firstMsg}${others > 0 ? ` (et ${others} autre${others > 1 ? 's' : ''} champ${others > 1 ? 's' : ''} à corriger)` : ''}`,
    fieldErrors,
  }
}

export function zodErrorResponse(error: z.ZodError, status = 400) {
  return NextResponse.json({ ...zodFieldErrors(error), details: error.issues }, { status })
}

/** Équivalent de parseBody, avec erreurs par champ. */
export function parseBodyFields<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> | NextResponse {
  const r = schema.safeParse(body)
  return r.success ? r.data : zodErrorResponse(r.error)
}

/** Chaînes vides → absentes (formulaires HTML : <select> « — », champs optionnels laissés vides). */
export function dropEmptyStrings<T extends Record<string, unknown>>(body: T, keep: string[] = []): Partial<T> {
  return Object.fromEntries(Object.entries(body ?? {}).filter(([k, v]) => keep.includes(k) || !(typeof v === 'string' && v.trim() === ''))) as Partial<T>
}
