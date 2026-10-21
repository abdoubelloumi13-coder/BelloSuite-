-- Facture électronique El Fatoora — stockage de la SIMULATION (signature + dépôt TTN simulés)
-- ⚠ Mode simulation — non valable fiscalement. Additif : aucune colonne ajoutée à "Invoice".
CREATE TABLE IF NOT EXISTS "EInvoiceSimulation" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "signedXml" TEXT,
    "signedAt" TIMESTAMP(3),
    "validatedXml" TEXT,
    "referenceTTN" TEXT,
    "qrDataUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EInvoiceSimulation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EInvoiceSimulation_invoiceId_key" ON "EInvoiceSimulation"("invoiceId");
CREATE INDEX IF NOT EXISTS "EInvoiceSimulation_tenantId_idx" ON "EInvoiceSimulation"("tenantId");
CREATE INDEX IF NOT EXISTS "EInvoiceSimulation_tenantId_referenceTTN_idx" ON "EInvoiceSimulation"("tenantId", "referenceTTN");
DO $$ BEGIN
  ALTER TABLE "EInvoiceSimulation" ADD CONSTRAINT "EInvoiceSimulation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "EInvoiceSimulation" ADD CONSTRAINT "EInvoiceSimulation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "EInvoiceSimulation" ENABLE ROW LEVEL SECURITY;
