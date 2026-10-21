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

COMMIT;
