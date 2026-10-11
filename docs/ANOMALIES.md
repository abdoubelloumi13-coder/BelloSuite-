# Anomalies nocturnes + email matinal « N points à vérifier »

Chaque nuit, BelloSuite analyse les documents de chaque entreprise (30 derniers jours, + impayés et historique
fournisseur sur 1 an), enregistre les anomalies et envoie aux administrateurs un email
« 3 points à vérifier ce matin » (top 3 par score, FR / EN / AR selon `Tenant.settings.locale`).

| Code | Détecteur | Gravité |
|---|---|---|
| DUPLICATE_SUPPLIER_INVOICE | même fournisseur + même référence (normalisée) / même montant + même date | HIGH / MEDIUM |
| INVOICE_TOTAL_MISMATCH | HT + FODEC + TVA + timbre ≠ TTC (tolérance 0,001) ; fournisseur : HT + TVA ≠ total (timbre 1,000 toléré) | HIGH |
| MISSING_TIMBRE | facture de vente TND émise sans droit de timbre | MEDIUM |
| UNUSUAL_VAT_RATE | taux hors 0/7/13/19 % ; TVA fournisseur incohérente avec le taux | MEDIUM / LOW |
| OVERDUE_INVOICE | facture impayée > 30 j après échéance (échéance par défaut : date + 30 j) | MEDIUM, HIGH > 90 j |
| NEGATIVE_STOCK | stock produit ou dépôt < 0 | HIGH / MEDIUM |
| SALE_BELOW_COST | prix net (remise %) < CMUP du produit | MEDIUM, HIGH < 80 % du CMUP |
| SUPPLIER_AMOUNT_OUTLIER | z-score ≥ 3 et ≥ 1,5 × la moyenne (≥ 5 factures d'historique) | MEDIUM, HIGH z ≥ 5 |
| DELIVERY_NOT_INVOICED | BL sans facture convertie après 7 j | MEDIUM, HIGH > 30 j |
| RECEIPT_NOT_INVOICED | commande reçue (totalement / partiellement) sans facture fournisseur liée après 15 j | MEDIUM |
| INVOICE_NUMBER_GAP | trous de numérotation par préfixe (FAC-2026-0003 → 0004) | MEDIUM |
| FUTURE_DATED_INVOICE | factures datées après demain (une anomalie regroupée) | LOW / MEDIUM |

Seuils réglables par entreprise dans `Tenant.settings.anomalies` : `windowDays`, `overdueDays`, `defaultPaymentTermDays`,
`deliveryNoteDays`, `receiptInvoiceDays`, `zThreshold`, `minHistory`, `timbreRequired`, `allowedVatRates`.

Statuts : **Ignorer** = faux positif, jamais réaffiché (même empreinte) ; **Résolu** = corrigé, rouvert si toujours
détecté la nuit suivante ; une anomalie ouverte qui n'est plus détectée passe en résolue automatiquement.

## Mise en service (à faire par Karim)

1. **Migration** : exécuter `supabase/migrations/20261011050000_anomalies.sql` dans Supabase → SQL Editor.
   Sans elle : widget masqué, page « migration non appliquée », cron 503 — rien d'autre n'est impacté.
2. **Variables Vercel** : `CRON_SECRET` (déjà requis) + un fournisseur email gratuit :
   - Gmail : `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`, `SMTP_PASS` (mot de passe d'application) ;
   - ou Resend : `RESEND_API_KEY` (+ `RESEND_FROM` d'un domaine vérifié ; sinon Resend n'envoie qu'au propriétaire du compte).
   Sans fournisseur : aucune erreur, anomalies visibles uniquement dans l'application.
3. **Planification** (une seule des deux) :
   - **A. Vercel Cron** (déjà dans `vercel.json`) : `0 5 * * *` = 06:00 heure de Tunis. Le plan Hobby n'autorise qu'une exécution par jour par cron et une heure approximative (dans l'heure).
   - **B. Supabase pg_cron + pg_net** : `supabase/snippets/anomalies_pg_cron.sql` (3 appels 05:00/05:10/05:20 UTC pour reprendre si beaucoup d'entreprises). Retirer alors l'entrée du `vercel.json`.

Le cron traite les entreprises par lots (budget ~40 s, `maxDuration = 60`) ; un verrou `AnomalyRun(tenantId, cronDay)`
garantit une seule analyse planifiée et un seul email par entreprise et par jour. Analyse manuelle : bouton « Analyser maintenant »
(admins, sans email) ou `GET /api/cron/anomalies?tenantId=…&email=0` avec le secret.

Destinataires : utilisateurs `ADMIN` actifs de l'entreprise, sauf ceux qui ont coché « Ne plus recevoir l'email matinal »
(`Tenant.settings.anomalies.emailOptOut`) ; à défaut d'admin, l'email de l'entreprise.
