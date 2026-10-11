-- =============================================================================
-- OPTION B (alternative gratuite au cron Vercel) — Supabase pg_cron + pg_net
-- =============================================================================
-- ⚠️  Snippet documenté, NON appliqué. À exécuter à la main dans Supabase → SQL Editor,
--     seulement si vous préférez Supabase à Vercel Cron (ne pas activer les deux :
--     le verrou "AnomalyRun"(tenantId, cronDay) évite de toute façon les doubles emails).
--
-- Avantages : plusieurs appels possibles (reprise si beaucoup de tenants), indépendant du plan Vercel.
-- Pré-requis : extensions pg_cron et pg_net (Database → Extensions), migration 20261011050000_anomalies.sql.
--
-- 1) Stocker le secret dans Vault (remplacer la valeur par celle de CRON_SECRET sur Vercel) :
--      select vault.create_secret('<CRON_SECRET>', 'bellosuite_cron_secret');
-- 2) Planifier : 05:00, 05:10, 05:20 UTC (= 06:00–06:20 Tunis). Chaque appel traite les tenants
--    pas encore analysés aujourd'hui (budget ~40 s) ; les appels suivants terminent le reste.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'bellosuite-anomalies',
  '0,10,20 5 * * *',
  $$
  SELECT net.http_get(
    url     := 'https://bellosuite.vercel.app/api/cron/anomalies',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'bellosuite_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);

-- Vérifier : SELECT * FROM cron.job;  SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
-- Désactiver : SELECT cron.unschedule('bellosuite-anomalies');
