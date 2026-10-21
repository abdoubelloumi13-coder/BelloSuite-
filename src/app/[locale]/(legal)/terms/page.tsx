import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { Link } from '@/i18n/routing'
import { LegalPage, LEGAL_CONTACT_EMAIL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation — BelloSuite",
  description: "Conditions générales d'utilisation du logiciel de gestion BelloSuite.",
}

// Texte de référence à faire valider par un juriste avant mise en production.
export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const mail = <a className="text-teal-700 underline" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
  return (
    <LegalPage
      locale={locale}
      title="Conditions générales d'utilisation"
      intro={<p>Les présentes conditions générales d&apos;utilisation (CGU) régissent l&apos;accès et l&apos;utilisation de BelloSuite, logiciel de gestion en ligne (stock, ventes, facturation, comptabilité, paie…) destiné aux entreprises. En créant un compte ou en utilisant le service, vous acceptez les présentes CGU.</p>}
      sections={[
        { title: 'Objet du service', body: <p>BelloSuite permet à une entreprise cliente de gérer ses opérations depuis une application web unique. Les modules accessibles dépendent de l&apos;offre souscrite. Un compte de démonstration peut être proposé ; les données qui y sont saisies peuvent être effacées à tout moment.</p> },
        { title: 'Compte et accès', body: <>
          <p>L&apos;inscription nécessite des informations exactes et à jour. L&apos;utilisateur est responsable de la confidentialité de ses identifiants et de toute action réalisée depuis son compte ; il signale sans délai toute utilisation non autorisée à {mail}.</p>
          <p>L&apos;administrateur de l&apos;entreprise cliente gère les utilisateurs et leurs rôles, y compris l&apos;accès accordé à un cabinet comptable.</p>
        </> },
        { title: 'Obligations de l’utilisateur', body: <ul className="list-disc ps-5 space-y-1">
          <li>Utiliser le service conformément aux lois en vigueur, notamment en matière fiscale, comptable et sociale ;</li>
          <li>Ne saisir que des données qu&apos;il est autorisé à traiter, et informer les personnes concernées (clients, salariés…) ;</li>
          <li>Ne pas tenter de porter atteinte à la sécurité, à la disponibilité ou à l&apos;intégrité du service.</li>
        </ul> },
        { title: 'Documents fiscaux et responsabilité', body: <p>BelloSuite fournit des outils de calcul (TVA, timbre fiscal, retenue à la source, paie…) et de génération de documents, y compris au format de facturation électronique. L&apos;entreprise cliente reste seule responsable de l&apos;exactitude des données saisies, du contrôle des documents émis et du respect de ses obligations déclaratives. BelloSuite ne se substitue pas à un expert-comptable.</p> },
        { title: 'Disponibilité', body: <p>BelloSuite s&apos;efforce d&apos;assurer un accès continu au service, sans garantie d&apos;absence d&apos;interruption. Des opérations de maintenance peuvent entraîner des indisponibilités temporaires, annoncées si possible à l&apos;avance.</p> },
        { title: 'Données et réversibilité', body: <p>Les données saisies restent la propriété de l&apos;entreprise cliente, qui peut les exporter pendant la durée de l&apos;abonnement. Leur traitement est décrit dans la <Link href="/privacy" className="text-teal-700 underline">politique de confidentialité</Link>.</p> },
        { title: 'Tarifs et résiliation', body: <p>Les conditions tarifaires sont celles de l&apos;offre souscrite. Chaque partie peut mettre fin à l&apos;abonnement selon les modalités prévues par cette offre. En cas de manquement grave aux présentes CGU, l&apos;accès peut être suspendu après notification.</p> },
        { title: 'Propriété intellectuelle', body: <p>Le logiciel, sa marque et ses contenus sont protégés. Aucune cession de droits n&apos;est consentie à l&apos;utilisateur, qui bénéficie d&apos;un droit d&apos;usage personnel et non exclusif pendant la durée de l&apos;abonnement.</p> },
        { title: 'Limitation de responsabilité', body: <p>Dans les limites autorisées par la loi, la responsabilité de BelloSuite est limitée aux dommages directs et prouvés résultant d&apos;un manquement à ses obligations, à l&apos;exclusion des pertes indirectes (manque à gagner, perte de clientèle…).</p> },
        { title: 'Droit applicable et litiges', body: <p>Les présentes CGU sont soumises au droit tunisien. À défaut de règlement amiable, tout litige relève de la compétence des tribunaux tunisiens compétents.</p> },
        { title: 'Contact', body: <p>Pour toute question relative aux présentes CGU : {mail}.</p> },
      ]}
    />
  )
}
