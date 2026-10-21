-- Numérotation légale des documents commerciaux + champs fiscaux (fix/fisc).
-- Idempotent : peut être rejouée sans effet.

-- 1. Séquences de numérotation (par tenant, série FAC/DEV/BC/BL/AV/NH, exercice)
CREATE TABLE IF NOT EXISTS "DocumentSequence" (
  "id"        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenantId"  TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "year"      INTEGER NOT NULL,
  "lastValue" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentSequence_tenantId_type_year_key"
  ON "DocumentSequence" ("tenantId", "type", "year");
ALTER TABLE "DocumentSequence" ENABLE ROW LEVEL SECURITY;

-- 2. Nouveaux champs Invoice
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "convertedFromId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "convertedAt" TIMESTAMP(3);
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "originalInvoiceId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "amountSettled" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "vatExemption" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "vatMention" TEXT;
CREATE INDEX IF NOT EXISTS "Invoice_tenantId_convertedFromId_idx" ON "Invoice" ("tenantId", "convertedFromId");
CREATE INDEX IF NOT EXISTS "Invoice_tenantId_originalInvoiceId_idx" ON "Invoice" ("tenantId", "originalInvoiceId");

-- Factures déjà réglées (avant le suivi des règlements partiels) : soldées en totalité
UPDATE "Invoice" SET "amountSettled" = "totalTTC"
WHERE "status" = 'PAID' AND "paymentEntryId" IS NOT NULL AND "amountSettled" = 0;

-- 3. Doublons existants (tenant, type, numéro) : le plus ancien garde son numéro, les suivants
--    reçoivent le suffixe -DUP1, -DUP2… (traçable, à régulariser par le tenant) avant l'index unique.
WITH d AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenantId", "type", "number" ORDER BY "createdAt", "id") AS rn
  FROM "Invoice"
)
UPDATE "Invoice" i SET "number" = i."number" || '-DUP' || (d.rn - 1)
FROM d
WHERE i."id" = d."id" AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_tenantId_type_number_key"
  ON "Invoice" ("tenantId", "type", "number");

-- 4. Retenue à la source : sens (opérée/déclarée au TEJ vs subie sur une vente)
ALTER TABLE "WithholdingTax" ADD COLUMN IF NOT EXISTS "direction" TEXT NOT NULL DEFAULT 'DECLARED';
ALTER TABLE "WithholdingTax" ADD COLUMN IF NOT EXISTS "purchaseOrderId" TEXT;
ALTER TABLE "WithholdingTax" ADD COLUMN IF NOT EXISTS "certificateReceivedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "WithholdingTax_tenantId_direction_idx" ON "WithholdingTax" ("tenantId", "direction");

-- Les RS rattachées à une facture de VENTE (Invoice) ont été opérées par le client : RS subies.
-- Elles ne doivent pas figurer dans la déclaration TEJ du tenant (seulement si encore brouillon).
UPDATE "WithholdingTax" SET "direction" = 'SUFFERED'
WHERE "invoiceId" IS NOT NULL AND "direction" = 'DECLARED' AND "tejStatus" IN ('DRAFT', 'CANCELLED');
