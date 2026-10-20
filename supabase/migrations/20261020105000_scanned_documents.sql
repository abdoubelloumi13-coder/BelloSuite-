-- Documents scannés (OCR) : table absente des migrations précédentes
CREATE TABLE IF NOT EXISTS "ScannedDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT NOT NULL,
    "extractedText" TEXT NOT NULL,
    "documentKind" TEXT,
    "supplierName" TEXT,
    "supplierMf" TEXT,
    "reference" TEXT,
    "date" TIMESTAMP(3),
    "totalAmount" DECIMAL(15,3),
    "currency" TEXT NOT NULL DEFAULT 'TND',
    "lines" JSONB,
    "avgConfidence" DOUBLE PRECISION,
    "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "reviewStatus" TEXT NOT NULL DEFAULT 'TO_REVIEW',
    "purchaseId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SCAN',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScannedDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ScannedDocument_tenantId_createdAt_idx" ON "ScannedDocument"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "ScannedDocument_tenantId_supplierName_idx" ON "ScannedDocument"("tenantId", "supplierName");
CREATE INDEX IF NOT EXISTS "ScannedDocument_tenantId_reference_idx" ON "ScannedDocument"("tenantId", "reference");
CREATE INDEX IF NOT EXISTS "ScannedDocument_tenantId_date_idx" ON "ScannedDocument"("tenantId", "date");
CREATE INDEX IF NOT EXISTS "ScannedDocument_tenantId_documentKind_idx" ON "ScannedDocument"("tenantId", "documentKind");
CREATE INDEX IF NOT EXISTS "ScannedDocument_fileHash_idx" ON "ScannedDocument"("fileHash");
DO $$ BEGIN
  ALTER TABLE "ScannedDocument" ADD CONSTRAINT "ScannedDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "ScannedDocument" ENABLE ROW LEVEL SECURITY;
