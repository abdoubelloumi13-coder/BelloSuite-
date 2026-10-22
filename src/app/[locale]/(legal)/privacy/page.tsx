import type { Metadata } from 'next'
import { setRequestLocale } from 'next-intl/server'
import { LegalPage, LEGAL_CONTACT_EMAIL } from '@/components/legal/LegalPage'

export const metadata: Metadata = {
  title: 'Politique de confidentialité — BelloSuite',
  description: 'Protection des données à caractère personnel sur BelloSuite (loi organique n° 2004-63 du 27 juillet 2004).',
}

// Texte de référence à faire valider par un juriste avant mise en production (déclaration INPDP à effectuer par l'éditeur).
export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const mail = <a className="text-teal-700 underline" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
  return (
    <LegalPage
      locale={locale}
      title="Politique de confidentialité"
      intro={<p>BelloSuite attache une grande importance à la protection des données à caractère personnel. La présente politique décrit les traitements réalisés dans le cadre du service, conformément à la loi organique n° 2004-63 du 27 juillet 2004 portant sur la protection des données à caractère personnel et à ses textes d&apos;application.</p>}
      sections={[
        { title: 'Responsable du traitement', body: <>
          <p>Pour les données des comptes utilisateurs (inscription, connexion, facturation de l&apos;abonnement), le responsable du traitement est l&apos;éditeur de BelloSuite, joignable à l&apos;adresse {mail}.</p>
          <p>Pour les données que chaque entreprise cliente saisit dans l&apos;application (clients, fournisseurs, salariés, factures…), l&apos;entreprise cliente reste responsable du traitement ; BelloSuite agit en qualité de sous-traitant et ne traite ces données que pour fournir le service.</p>
        </> },
        { title: 'Données collectées', body: <ul className="list-disc ps-5 space-y-1">
          <li>Données d&apos;identification et de contact : nom, adresse e-mail, téléphone, raison sociale, matricule fiscal ;</li>
          <li>Données de connexion et de sécurité : journaux d&apos;accès, adresse IP, appareil, horodatages ;</li>
          <li>Données métier saisies par l&apos;entreprise cliente : stock, documents commerciaux, comptabilité, paie et ressources humaines ;</li>
          <li>Préférences : langue, consentement aux cookies et aux notifications.</li>
        </ul> },
        { title: 'Finalités et bases légales', body: <ul className="list-disc ps-5 space-y-1">
          <li>Fournir le service et exécuter le contrat d&apos;abonnement ;</li>
          <li>Sécuriser les comptes et prévenir la fraude ;</li>
          <li>Respecter les obligations légales, notamment fiscales et comptables (facturation électronique, conservation des pièces) ;</li>
          <li>Avec votre consentement : notifications, mesure d&apos;audience et communications commerciales.</li>
        </ul> },
        { title: 'Destinataires', body: <>
          <p>Les données ne sont accessibles qu&apos;aux personnes habilitées de l&apos;entreprise cliente, au cabinet comptable qu&apos;elle a autorisé, et aux équipes techniques de BelloSuite dans la stricte limite de leurs missions.</p>
          <p>Elles peuvent être transmises aux administrations lorsque la loi l&apos;exige (par exemple, plateforme nationale de facturation électronique) et aux prestataires techniques nécessaires au service (hébergement, envoi d&apos;e-mails ou de SMS). BelloSuite ne vend aucune donnée personnelle.</p>
        </> },
        { title: 'Hébergement et transferts', body: <p>Le service est hébergé par des prestataires techniques (notamment Vercel et Supabase) dont les serveurs peuvent être situés hors de Tunisie. Tout transfert de données vers l&apos;étranger est réalisé dans le respect des articles 50 et suivants de la loi organique n° 2004-63 et, le cas échéant, sous réserve de l&apos;autorisation de l&apos;Instance Nationale de Protection des Données Personnelles (INPDP).</p> },
        { title: 'Durée de conservation', body: <p>Les données du compte sont conservées pendant la durée de l&apos;abonnement, puis supprimées ou anonymisées dans un délai raisonnable après sa clôture, sauf obligation légale contraire. Les pièces comptables et fiscales sont conservées pendant les durées légales (notamment dix ans). Les journaux de connexion sont conservés pour une durée limitée à des fins de sécurité.</p> },
        { title: 'Sécurité', body: <p>BelloSuite met en œuvre des mesures techniques et organisationnelles adaptées : chiffrement des échanges (HTTPS), cloisonnement des données par entreprise, contrôle des accès par rôle, mots de passe hachés et sauvegardes régulières.</p> },
        { title: 'Vos droits', body: <>
          <p>Conformément à la loi organique n° 2004-63, vous disposez d&apos;un droit d&apos;accès à vos données, d&apos;un droit de rectification, de complément ou de suppression des données inexactes, ainsi que d&apos;un droit d&apos;opposition au traitement pour des raisons légitimes et à toute utilisation à des fins de prospection.</p>
          <p>Pour exercer ces droits, écrivez à {mail}. Si les données ont été saisies par votre employeur ou par un de vos fournisseurs utilisant BelloSuite, adressez-vous en priorité à cette entreprise. Vous pouvez également saisir l&apos;INPDP (www.inpdp.tn).</p>
        </> },
        { title: 'Cookies', body: <p>BelloSuite utilise des cookies strictement nécessaires (session, langue, sécurité). Les autres traceurs ne sont déposés qu&apos;avec votre accord, recueilli par le bandeau prévu à cet effet ; vous pouvez retirer ce consentement à tout moment.</p> },
        { title: 'Modifications', body: <p>Cette politique peut évoluer. La date de dernière mise à jour figure en haut de la page ; en cas de changement important, les utilisateurs en sont informés dans l&apos;application ou par e-mail.</p> },
      ]}
    />
  )
}
