-- RS 2026 : régime du bénéficiaire, contact (obligatoire dans le fichier TEJ), taux de TVA
ALTER TABLE "WithholdingTax" ADD COLUMN IF NOT EXISTS "beneficiaryRegime" TEXT;
ALTER TABLE "WithholdingTax" ADD COLUMN IF NOT EXISTS "beneficiaryEmail" TEXT;
ALTER TABLE "WithholdingTax" ADD COLUMN IF NOT EXISTS "beneficiaryPhone" TEXT;
ALTER TABLE "WithholdingTax" ADD COLUMN IF NOT EXISTS "vatRate" DECIMAL(65,30);
