# BelloSuite ERP

BelloSuite est un système ERP modulaire SaaS conçu spécifiquement pour le marché tunisien (PMEs).
Il offre une gestion complète de l'entreprise via une architecture multi-tenant et des modules activables à la demande.

## Fonctionnalités (Modules)
- **Gestion de Stock** : Produits, mouvements, transferts, inventaires.
- **Commercial** : Clients, fournisseurs, devis, factures (Intégration TTN / El Fatoora).
- **Comptabilité** : Plan comptable, journaux, rapprochement bancaire.
- **GRH & Paie** : Employés, contrats, pointage, fiches de paie.
- **GMAO / GPAO / GQAO** : Maintenance, production, qualité (en développement).

## Stack Technique
- **Framework** : Next.js 16.4 (App Router, next-intl fr/en/ar)
- **Base de données** : PostgreSQL via Supabase
- **ORM** : Prisma 5.22 (schéma multi-fichiers dans `prisma/schema/`)
- **Styling** : Tailwind CSS, Lucide Icons
- **Langage** : TypeScript

## Prérequis
- Node.js ≥ 20.9 (version de référence : `.nvmrc`, Node 22)
- Compte Supabase
- Compte Resend (pour les emails)

## Installation & Configuration

1. **Cloner le projet**
   ```bash
   git clone https://github.com/belloumi79/BelloSuite.git
   cd BelloSuite
   ```

2. **Installer les dépendances**
   ```bash
   npm install
   ```

3. **Configurer les variables d'environnement**
   ```bash
   cp .env.example .env.local
   ```
   Puis remplissez au minimum `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `DATABASE_URL`, `DIRECT_URL`, `SESSION_SECRET` (≥ 32 caractères), `CRON_SECRET` et `ASP_ENCRYPTION_KEY`.
   Les autres variables (e-mail, IA, relances, TTN) sont optionnelles et documentées dans `.env.example`.

4. **Base de données (Prisma)**
   ```bash
   npx prisma generate --schema ./prisma/schema
   npm run db:push        # prisma db push --schema ./prisma/schema
   npm run db:seed        # données de base (npm run db:seed-demo pour la démo)
   ```
   Les migrations SQL Supabase (RLS, index…) se trouvent dans `supabase/migrations/` et s'exécutent
   dans l'éditeur SQL Supabase.

5. **Vérifications**
   ```bash
   npx tsc --noEmit
   npm test
   npm run i18n:check     # mêmes clés dans messages/fr.json, en.json, ar.json
   ```

6. **Lancer le serveur de développement**
   ```bash
   npm run dev
   ```

L'application sera accessible sur `http://localhost:3000`.

## Contribuer
Veuillez vous référer au fichier `CODING_STANDARDS.md` pour les règles de formatage et de contribution.
