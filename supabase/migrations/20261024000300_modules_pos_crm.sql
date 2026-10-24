-- Ajoute POS et CRM au catalogue des modules (grille de lancement, HT TND/mois).
-- Idempotent : met seulement le prix à jour si la ligne existe déjà.
INSERT INTO "Module" ("id", "name", "displayName", "description", "icon", "monthlyPrice", "isActive", "createdAt")
VALUES
  (gen_random_uuid()::text, 'pos', 'Point de vente (POS)', 'Caisse et ventes au comptoir', '🛒', 7.5, true, now()),
  (gen_random_uuid()::text, 'crm', 'CRM & Prospection', 'Pipeline de leads, suivi commercial', '🎯', 14.5, true, now())
ON CONFLICT ("name") DO UPDATE SET "monthlyPrice" = EXCLUDED."monthlyPrice";
