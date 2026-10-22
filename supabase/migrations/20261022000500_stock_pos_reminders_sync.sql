-- Synchronisation base ↔ schéma Prisma pour Stock / POS / Relances (audit 21/10/2026).
-- Cause des créations d'article « muettes » : colonnes déclarées dans prisma/schema/stock.prisma mais absentes
-- en production (Prisma lit toutes les colonnes au RETURNING → P2022 → 500 ignoré par le formulaire).
-- STRICTEMENT ADDITIF et IDEMPOTENT (ADD COLUMN / CREATE ... IF NOT EXISTS). Rejouable sans effet de bord.

BEGIN;

-- ─── Stock : Product ─────────────────────────────────────────
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "unit" TEXT NOT NULL DEFAULT 'unit';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "fodec" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "minStock" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "currentStock" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "averageCost" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reorderPoint" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reorderQty" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "variants" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
CREATE UNIQUE INDEX IF NOT EXISTS "Product_tenantId_code_key" ON "Product"("tenantId", "code");

-- ─── Stock : Warehouse ───────────────────────────────────────
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "manager" TEXT;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS "Warehouse_tenantId_code_key" ON "Warehouse"("tenantId", "code");

-- ─── Stock : ProductCategory (texte libre → référentiel) ─────
CREATE TABLE IF NOT EXISTS "ProductCategory" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProductCategory_tenantId_name_key" ON "ProductCategory"("tenantId", "name");
ALTER TABLE "ProductCategory" ENABLE ROW LEVEL SECURITY;

-- ─── Stock : ProductWarehouse ────────────────────────────────
ALTER TABLE "ProductWarehouse" ADD COLUMN IF NOT EXISTS "minStock" DECIMAL(65,30);

-- ─── POS : colonnes utilisées par la caisse (remise, monnaie, timbre, multi-paiements) ─
ALTER TABLE "POSOrder" ADD COLUMN IF NOT EXISTS "discountPercent" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "POSOrder" ADD COLUMN IF NOT EXISTS "discountAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "POSOrder" ADD COLUMN IF NOT EXISTS "changeGiven" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "POSOrder" ADD COLUMN IF NOT EXISTS "paidAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "POSOrder" ADD COLUMN IF NOT EXISTS "timbreFiscal" DECIMAL(65,30) NOT NULL DEFAULT 1;
ALTER TABLE "POSOrder" ADD COLUMN IF NOT EXISTS "isPaid" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "POSOrder" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "POSOrderItem" ADD COLUMN IF NOT EXISTS "discount" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "POSOrderItem" ADD COLUMN IF NOT EXISTS "productCode" TEXT;
ALTER TABLE "POSSession" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "POSSession" ADD COLUMN IF NOT EXISTS "closingCash" DECIMAL(65,30);
ALTER TABLE "POSSession" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "POSSession_tenantId_status_openedAt_idx" ON "POSSession"("tenantId", "status", "openedAt");
CREATE INDEX IF NOT EXISTS "POSOrder_tenantId_sessionId_idx" ON "POSOrder"("tenantId", "sessionId");

-- ─── Relances : traçabilité (statut sent / simulated / failed, lien suivi) + dédup ─
ALTER TABLE "PaymentReminder" ADD COLUMN IF NOT EXISTS "response" TEXT;
ALTER TABLE "PaymentReminder" ADD COLUMN IF NOT EXISTS "errorMessage" TEXT;
ALTER TABLE "PaymentReminder" ADD COLUMN IF NOT EXISTS "followUpId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "lastReminderSentAt" TIMESTAMP(3);
ALTER TABLE "PaymentFollowUp" ADD COLUMN IF NOT EXISTS "nextReminderDate" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "PaymentReminder_invoiceId_sentAt_idx" ON "PaymentReminder"("invoiceId", "sentAt");

COMMIT;
