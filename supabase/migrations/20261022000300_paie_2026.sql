-- Paie 2026 (branche fix/paie) — migration IDEMPOTENTE, rejouable sans risque.
-- 1) PaieParameters : table créée si absente, paramètres 2026 (CNSS 9,68/17,07 %, barème IRPP 8 tranches,
--    frais pro, CSS, SMIG 554,736 DT / 2,667 DT/h), unicité par tenant (upsert).
-- 2) PaySlip : colonnes css / cnssPatronal ; colonnes HÉRITÉES (anciens schémas : periodStart, grossSalary,
--    month, baseSalary, taxBase, netSalary…) rendues NULLables — elles faisaient échouer « Générer Bulletins »
--    (violation NOT NULL sur des colonnes inconnues de Prisma → « Internal error »).
-- 3) Employee : situation familiale / chef de famille / enfants à charge (déjà présents normalement).
-- Taux et barèmes à faire valider par un comptable.

-- ─── 1) PaieParameters ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PaieParameters" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "annee" INTEGER NOT NULL DEFAULT 2026,
    "irppTranche1Max" DECIMAL(65,30) NOT NULL DEFAULT 5000,
    "irppTranche2Max" DECIMAL(65,30) NOT NULL DEFAULT 10000,
    "irppTranche3Max" DECIMAL(65,30) NOT NULL DEFAULT 20000,
    "irppTranche4Max" DECIMAL(65,30) NOT NULL DEFAULT 30000,
    "irppTaux1" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "irppTaux2" DECIMAL(65,30) NOT NULL DEFAULT 15,
    "irppTaux3" DECIMAL(65,30) NOT NULL DEFAULT 25,
    "irppTaux4" DECIMAL(65,30) NOT NULL DEFAULT 30,
    "irppTaux5" DECIMAL(65,30) NOT NULL DEFAULT 33,
    "cnavsPatronal" DECIMAL(65,30) NOT NULL DEFAULT 6.5,
    "cnavsPlafond" DECIMAL(65,30) NOT NULL DEFAULT 10000,
    "amoPatronal" DECIMAL(65,30) NOT NULL DEFAULT 2.5,
    "tfpPatronal" DECIMAL(65,30) NOT NULL DEFAULT 1,
    "fppsPatronal" DECIMAL(65,30) NOT NULL DEFAULT 0.4,
    "cnrpsSalarial" DECIMAL(65,30) NOT NULL DEFAULT 4.75,
    "cnssSalarial" DECIMAL(65,30) NOT NULL DEFAULT 1.5,
    "cnavsSalarial" DECIMAL(65,30) NOT NULL DEFAULT 3.5,
    "amoSalarial" DECIMAL(65,30) NOT NULL DEFAULT 0.75,
    "cnrpsPlafond" DECIMAL(65,30) NOT NULL DEFAULT 10000,
    "cnssPlafond" DECIMAL(65,30) NOT NULL DEFAULT 10000,
    "cnavsPlafondSal" DECIMAL(65,30) NOT NULL DEFAULT 10000,
    "deductionChefFamille" DECIMAL(65,30) NOT NULL DEFAULT 300,
    "deductionParEnfant" DECIMAL(65,30) NOT NULL DEFAULT 100,
    "enfantsMaxDeductible" INTEGER NOT NULL DEFAULT 4,
    "smigMensuel" DECIMAL(65,30) NOT NULL DEFAULT 554.736,
    "heuresSup25" DECIMAL(65,30) NOT NULL DEFAULT 25,
    "heuresSup50" DECIMAL(65,30) NOT NULL DEFAULT 50,
    "heuresSup75" DECIMAL(65,30) NOT NULL DEFAULT 75,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaieParameters_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "irppTranche5Max" DECIMAL(65,30) NOT NULL DEFAULT 40000;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "irppTranche6Max" DECIMAL(65,30) NOT NULL DEFAULT 50000;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "irppTranche7Max" DECIMAL(65,30) NOT NULL DEFAULT 70000;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "irppTaux6" DECIMAL(65,30) NOT NULL DEFAULT 36;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "irppTaux7" DECIMAL(65,30) NOT NULL DEFAULT 38;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "irppTaux8" DECIMAL(65,30) NOT NULL DEFAULT 40;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "tauxCnssSalarial" DECIMAL(65,30) NOT NULL DEFAULT 9.68;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "tauxCnssPatronal" DECIMAL(65,30) NOT NULL DEFAULT 17.07;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "fraisProTaux" DECIMAL(65,30) NOT NULL DEFAULT 10;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "fraisProPlafond" DECIMAL(65,30) NOT NULL DEFAULT 2000;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "cssTaux" DECIMAL(65,30) NOT NULL DEFAULT 0.5;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "cssSeuilExoneration" DECIMAL(65,30) NOT NULL DEFAULT 5000;
ALTER TABLE "PaieParameters" ADD COLUMN IF NOT EXISTS "smigHoraire" DECIMAL(65,30) NOT NULL DEFAULT 2.667;

-- Nouveaux défauts (Prisma) pour les lignes créées hors application
ALTER TABLE "PaieParameters" ALTER COLUMN "annee" SET DEFAULT 2026;
ALTER TABLE "PaieParameters" ALTER COLUMN "irppTranche3Max" SET DEFAULT 20000;
ALTER TABLE "PaieParameters" ALTER COLUMN "irppTranche4Max" SET DEFAULT 30000;
ALTER TABLE "PaieParameters" ALTER COLUMN "irppTaux2" SET DEFAULT 15;
ALTER TABLE "PaieParameters" ALTER COLUMN "irppTaux3" SET DEFAULT 25;
ALTER TABLE "PaieParameters" ALTER COLUMN "irppTaux4" SET DEFAULT 30;
ALTER TABLE "PaieParameters" ALTER COLUMN "irppTaux5" SET DEFAULT 33;
ALTER TABLE "PaieParameters" ALTER COLUMN "deductionChefFamille" SET DEFAULT 300;
ALTER TABLE "PaieParameters" ALTER COLUMN "deductionParEnfant" SET DEFAULT 100;
ALTER TABLE "PaieParameters" ALTER COLUMN "enfantsMaxDeductible" SET DEFAULT 4;
ALTER TABLE "PaieParameters" ALTER COLUMN "smigMensuel" SET DEFAULT 554.736;

-- Lignes restées sur les anciens défauts 2025 (barème 5 tranches 26/32/36/40, déductions 150/40, SMIG 469,4) → barème 2026.
-- Une ligne déjà personnalisée par le tenant n'est pas touchée.
UPDATE "PaieParameters" SET
  "irppTranche3Max" = 20000, "irppTranche4Max" = 30000,
  "irppTaux2" = 15, "irppTaux3" = 25, "irppTaux4" = 30, "irppTaux5" = 33,
  "irppTranche5Max" = 40000, "irppTranche6Max" = 50000, "irppTranche7Max" = 70000,
  "irppTaux6" = 36, "irppTaux7" = 38, "irppTaux8" = 40
WHERE "irppTranche3Max" = 30000 AND "irppTranche4Max" = 50000
  AND "irppTaux2" = 26 AND "irppTaux3" = 32 AND "irppTaux4" = 36 AND "irppTaux5" = 40;
UPDATE "PaieParameters" SET "deductionChefFamille" = 300, "deductionParEnfant" = 100, "enfantsMaxDeductible" = 4
WHERE "deductionChefFamille" = 150 AND "deductionParEnfant" = 40 AND "enfantsMaxDeductible" = 6;
UPDATE "PaieParameters" SET "smigMensuel" = 554.736 WHERE "smigMensuel" = 469.4;

-- Une seule ligne par tenant (l'API fait un upsert sur tenantId) : doublons supprimés (on garde la plus récente)
DELETE FROM "PaieParameters" p
USING "PaieParameters" q
WHERE p."tenantId" = q."tenantId"
  AND (p."updatedAt" < q."updatedAt" OR (p."updatedAt" = q."updatedAt" AND p."id" < q."id"));
CREATE UNIQUE INDEX IF NOT EXISTS "PaieParameters_tenantId_key" ON "PaieParameters"("tenantId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaieParameters_tenantId_fkey') THEN
    BEGIN
      ALTER TABLE "PaieParameters" ADD CONSTRAINT "PaieParameters_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    EXCEPTION WHEN others THEN RAISE NOTICE 'skip PaieParameters_tenantId_fkey: %', SQLERRM;
    END;
  END IF;
END $$;

-- Deny-by-default (comme les autres tables de paie)
ALTER TABLE "PaieParameters" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."PaieParameters" FROM anon, authenticated;

-- ─── 2) PaySlip ────────────────────────────────────────────────────
ALTER TABLE "PaySlip" ADD COLUMN IF NOT EXISTS "css" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "PaySlip" ADD COLUMN IF NOT EXISTS "cnssPatronal" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "PaySlip" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "PaySlip" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "PaySlip" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Colonnes héritées NOT NULL sans défaut, inconnues du schéma Prisma actuel → NULLables
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'PaySlip'
      AND is_nullable = 'NO' AND column_default IS NULL
      AND column_name NOT IN (
        'id','tenantId','employeeId','reference','mois','annee','joursTravailles','salaireBase','heuresSupQte',
        'heuresSupMontant','primeAnciennete','primeTransport','primePanier','autresPrimes','brutGlobal',
        'cnrpsSalaire','cnssSalaire','cnavisSalaire','amoSalaire','totalCotisations','salaireImposable',
        'deductionChefFam','deductionEnfants','irpp','css','cnssPatronal','deductionAbsences','deductionRetards',
        'autresDeductions','netAPayer','statut','pdfUrl','notes','accountingEntryId','createdAt','updatedAt')
  LOOP
    EXECUTE format('ALTER TABLE "PaySlip" ALTER COLUMN %I DROP NOT NULL', c.column_name);
    RAISE NOTICE 'PaySlip.% : NOT NULL retiré (colonne héritée)', c.column_name;
  END LOOP;
END $$;

-- ─── 3) Employee : situation familiale ─────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EstadoCivil') THEN
    CREATE TYPE "EstadoCivil" AS ENUM ('CELIBATAIRE', 'MARIE', 'DIVORCE', 'VEUF');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SituationFamiliale') THEN
    CREATE TYPE "SituationFamiliale" AS ENUM ('CHEF_FAMILLE', 'NON_CHEF_FAMILLE');
  END IF;
END $$;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "etatCivil" "EstadoCivil" NOT NULL DEFAULT 'CELIBATAIRE';
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "enfantsCharge" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "situationFamiliale" "SituationFamiliale" NOT NULL DEFAULT 'NON_CHEF_FAMILLE';
