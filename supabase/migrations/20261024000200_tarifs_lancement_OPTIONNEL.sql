-- OPTIONNEL — Grille de lancement « -50 % sous le moins cher du marché tunisien » (HT, TND/mois).
-- À exécuter seulement après validation commerciale. Références relevées le 24/10/2026 :
-- Clic2Up Pro 19 (facturation), Gastevo 20/module (ventes, stock, caisse), Clario 35 (compta),
-- Gastevo RH 40 + Paie 25, Gastevo CRM 29. GMAO/GPAO : pas de prix SaaS tunisien public (estimation).
BEGIN;
UPDATE "Module" SET "monthlyPrice" = 9.5,  "includedUsers" = 3, "pricePerUser" = 2 WHERE "name" = 'commercial';
UPDATE "Module" SET "monthlyPrice" = 10,   "includedUsers" = 3, "pricePerUser" = 2 WHERE "name" = 'stock';
UPDATE "Module" SET "monthlyPrice" = 7.5,  "includedUsers" = 1, "pricePerUser" = 5 WHERE "name" = 'pos';
UPDATE "Module" SET "monthlyPrice" = 17.5 WHERE "name" = 'accounting';
UPDATE "Module" SET "monthlyPrice" = 32.5 WHERE "name" = 'hr';
UPDATE "Module" SET "monthlyPrice" = 14.5 WHERE "name" = 'crm';
UPDATE "Module" SET "monthlyPrice" = 19.5 WHERE "name" = 'gmao';
UPDATE "Module" SET "monthlyPrice" = 29.5 WHERE "name" = 'gpao';
COMMIT;
