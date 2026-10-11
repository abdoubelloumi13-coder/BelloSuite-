-- =============================================================================
-- BelloSuite — Anomalies nocturnes : tables "Anomaly" et "AnomalyRun"
-- =============================================================================
-- ⚠️  NE PAS appliquer automatiquement : à exécuter à la main dans
--     Supabase → SQL Editor (production) AVANT d'activer le cron /api/cron/anomalies.
--     Tant que les tables n'existent pas : le widget « Points à vérifier » reste masqué,
--     la page affiche « migration non appliquée » et le cron répond 503 (aucune autre page impactée).
-- Correspond aux modèles Prisma `Anomaly` / `AnomalyRun` (prisma/schema/anomalies.prisma).
-- Additive et idempotente.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public."Anomaly" (
  "id"           TEXT          NOT NULL,
  "tenantId"     TEXT          NOT NULL,
  "type"         TEXT          NOT NULL,
  "severity"     TEXT          NOT NULL,
  "score"        INTEGER       NOT NULL DEFAULT 0,
  "fingerprint"  TEXT          NOT NULL,
  "documentKind" TEXT,
  "documentId"   TEXT,
  "documentRef"  TEXT,
  "amount"       DECIMAL(65,30),
  "details"      JSONB         NOT NULL DEFAULT '{}',
  "status"       TEXT          NOT NULL DEFAULT 'OPEN',
  "firstSeenAt"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"   TIMESTAMP(3),
  "resolvedById" TEXT,
  "lastRunId"    TEXT,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Anomaly_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Anomaly_status_check" CHECK ("status" IN ('OPEN', 'IGNORED', 'RESOLVED')),
  CONSTRAINT "Anomaly_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Anomaly_tenantId_fingerprint_key" ON public."Anomaly" ("tenantId", "fingerprint");
CREATE INDEX IF NOT EXISTS "Anomaly_tenantId_status_score_idx" ON public."Anomaly" ("tenantId", "status", "score");

CREATE TABLE IF NOT EXISTS public."AnomalyRun" (
  "id"         TEXT         NOT NULL,
  "tenantId"   TEXT         NOT NULL,
  "trigger"    TEXT         NOT NULL DEFAULT 'CRON',
  "cronDay"    TEXT,
  "status"     TEXT         NOT NULL DEFAULT 'RUNNING',
  "detected"   INTEGER      NOT NULL DEFAULT 0,
  "newCount"   INTEGER      NOT NULL DEFAULT 0,
  "openCount"  INTEGER      NOT NULL DEFAULT 0,
  "emailedTo"  INTEGER      NOT NULL DEFAULT 0,
  "mailer"     TEXT,
  "error"      TEXT,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "AnomalyRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnomalyRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES public."Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 1 exécution planifiée par tenant et par jour (verrou anti-doublon d'email ; NULL = exécution manuelle)
CREATE UNIQUE INDEX IF NOT EXISTS "AnomalyRun_tenantId_cronDay_key" ON public."AnomalyRun" ("tenantId", "cronDay");
CREATE INDEX IF NOT EXISTS "AnomalyRun_tenantId_startedAt_idx" ON public."AnomalyRun" ("tenantId", "startedAt");

-- Deny by default pour anon/authenticated (Prisma utilise le rôle postgres, non soumis à la RLS)
ALTER TABLE public."Anomaly" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AnomalyRun" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public."Anomaly" FROM anon, authenticated;
REVOKE ALL ON public."AnomalyRun" FROM anon, authenticated;

COMMIT;
