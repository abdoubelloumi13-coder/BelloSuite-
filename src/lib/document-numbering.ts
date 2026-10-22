/**
 * Numérotation légale des documents commerciaux : séquence continue, sans trou ni doublon,
 * par tenant + type de document + exercice (année civile de la date du document).
 * Format : FAC-2026-00001, DEV-2026-00001, BC-…, BL-…, AV-….
 *
 * Le numéro est attribué UNIQUEMENT côté serveur, dans la transaction qui crée le document :
 * INSERT … ON CONFLICT DO UPDATE SET lastValue = lastValue + 1 RETURNING — atomique et
 * verrouillant la ligne de séquence jusqu'au COMMIT (deux créations simultanées ne peuvent pas
 * obtenir le même numéro ; un rollback libère le numéro, la séquence reste donc continue).
 * À la première utilisation, la séquence repart du plus grand numéro déjà émis au même format
 * (documents créés avant la migration), pour ne jamais rentrer en collision.
 * Garde-fou base : index unique Invoice(tenantId, type, number).
 */
import type { Prisma } from '@prisma/client'

export const DOCUMENT_PREFIX: Record<string, string> = {
  INVOICE: 'FAC',
  INVOICE_SERVICE: 'FAC',
  INVOICE_HONORARY: 'NH',
  QUOTE: 'DEV',
  ORDER: 'BC',
  DELIVERY_NOTE: 'BL',
  CREDIT_NOTE: 'AV',
}

export function documentPrefix(type: string): string {
  return DOCUMENT_PREFIX[type] ?? 'DOC'
}

/** Exercice d'un document = année de sa date (UTC : les dates de document sont des jours « AAAA-MM-JJ »). */
export function fiscalYearOf(date: Date | string | null | undefined): number {
  const d = date ? new Date(date) : new Date()
  return Number.isNaN(d.getTime()) ? new Date().getUTCFullYear() : d.getUTCFullYear()
}

export function formatDocumentNumber(type: string, year: number, seq: number): string {
  return `${documentPrefix(type)}-${year}-${String(seq).padStart(5, '0')}`
}

/** Motif SQL (POSIX) des numéros au format légal pour ce préfixe et cet exercice. */
export function documentNumberPattern(type: string, year: number): string {
  return `^${documentPrefix(type)}-${year}-[0-9]+$`
}

type Tx = Prisma.TransactionClient | { $queryRaw: (...args: any[]) => Promise<unknown> }

/**
 * Réserve le prochain numéro de la séquence (à appeler DANS la transaction de création).
 * Les factures de service partagent la séquence FAC des factures (même série légale).
 */
export async function nextDocumentNumberTx(tx: Tx, tenantId: string, type: string, date?: Date | string | null): Promise<string> {
  const year = fiscalYearOf(date)
  const seqType = documentPrefix(type) // une séquence par série (FAC regroupe INVOICE et INVOICE_SERVICE)
  const pattern = documentNumberPattern(type, year)
  const rows = (await (tx as any).$queryRaw`
    INSERT INTO "DocumentSequence" ("id", "tenantId", "type", "year", "lastValue", "updatedAt")
    VALUES (
      gen_random_uuid()::text, ${tenantId}, ${seqType}, ${year},
      COALESCE((
        SELECT MAX(CAST(substring("number" from '([0-9]+)$') AS INTEGER))
        FROM "Invoice"
        WHERE "tenantId" = ${tenantId} AND "number" ~ ${pattern}
      ), 0) + 1,
      NOW()
    )
    ON CONFLICT ("tenantId", "type", "year")
    DO UPDATE SET "lastValue" = "DocumentSequence"."lastValue" + 1, "updatedAt" = NOW()
    RETURNING "lastValue"
  `) as Array<{ lastValue: number | bigint }>
  const value = Number(rows?.[0]?.lastValue)
  if (!Number.isFinite(value) || value < 1) throw new Error('Séquence de numérotation indisponible')
  return formatDocumentNumber(type, year, value)
}
