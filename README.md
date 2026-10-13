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
- **Framework** : Next.js 15 (App Router)
- **Base de données** : PostgreSQL via Supabase
- **ORM** : Prisma 7
- **Styling** : Tailwind CSS, Lucide Icons
- **Langage** : TypeScript

## Prérequis
- Node.js (v18+)
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
   Créez un fichier `.env.local` à la racine avec :
   ```env
   NEXT_PUBLIC_SUPABASE_URL=votre_url_supabase
   NEXT_PUBLIC_SUPABASE_ANON_KEY=votre_cle_anon
   SUPABASE_SERVICE_ROLE_KEY=votre_cle_service_role
   RESEND_API_KEY=votre_cle_resend
   SESSION_SECRET=votre_secret_session_32_bytes
   ```

4. **Base de données (Prisma)**
   ```bash
   npx prisma generate
   npx prisma db push
   npx prisma db seed
   ```

5. **Lancer le serveur de développement**
   ```bash
   npm run dev
   ```

L'application sera accessible sur `http://localhost:3000`.

## Contribuer
Veuillez vous référer au fichier `CODING_STANDARDS.md` pour les règles de formatage et de contribution.

## Statut du déploiement Vercel
Dernière mise à jour: $(date -u +"%Y-%m-%d %H:%M:%S UTC")
- Sidebar responsive mobile : ✅ Implémenté
- Breakpoints Tailwind : ✅ xs (480px) & 3xl (1920px)
- Tables responsives : ✅ overflow-x-auto wrappers
- Module CRM : ✅ Intégré avec gestion des leads
