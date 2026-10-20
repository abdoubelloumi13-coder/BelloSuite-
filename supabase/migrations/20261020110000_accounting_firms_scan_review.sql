-- Cabinets comptables (espace multi-clients) + revue des pièces scannées
CREATE TABLE IF NOT EXISTS "AccountingFirm" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "matriculeFiscal" TEXT,
  "email" TEXT,
  "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "FirmMember" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL REFERENCES "AccountingFirm"("id") ON DELETE CASCADE,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL DEFAULT 'STAFF',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FirmMember_firmId_userId_key" ON "FirmMember"("firmId", "userId");
CREATE INDEX IF NOT EXISTS "FirmMember_userId_idx" ON "FirmMember"("userId");

CREATE TABLE IF NOT EXISTS "FirmClientAccess" (
  "id" TEXT PRIMARY KEY,
  "firmId" TEXT NOT NULL REFERENCES "AccountingFirm"("id") ON DELETE CASCADE,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "origin" TEXT NOT NULL DEFAULT 'INVITE',
  "grantedById" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FirmClientAccess_firmId_tenantId_key" ON "FirmClientAccess"("firmId", "tenantId");
CREATE INDEX IF NOT EXISTS "FirmClientAccess_tenantId_idx" ON "FirmClientAccess"("tenantId");

CREATE TABLE IF NOT EXISTS "FirmInvite" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "codeHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "usedByFirm" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "FirmInvite_codeHash_key" ON "FirmInvite"("codeHash");
CREATE INDEX IF NOT EXISTS "FirmInvite_tenantId_idx" ON "FirmInvite"("tenantId");

-- Revue des documents scannés
ALTER TABLE "ScannedDocument" ADD COLUMN IF NOT EXISTS "reviewStatus" TEXT NOT NULL DEFAULT 'TO_REVIEW';
ALTER TABLE "ScannedDocument" ADD COLUMN IF NOT EXISTS "purchaseId" TEXT;
ALTER TABLE "ScannedDocument" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
ALTER TABLE "ScannedDocument" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
CREATE INDEX IF NOT EXISTS "ScannedDocument_tenantId_reviewStatus_idx" ON "ScannedDocument"("tenantId", "reviewStatus");

-- Accès uniquement côté serveur (Prisma) : bloquer l'API publique Supabase
ALTER TABLE "AccountingFirm" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FirmMember" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FirmClientAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FirmInvite" ENABLE ROW LEVEL SECURITY;
