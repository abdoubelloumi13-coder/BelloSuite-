import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/routing'

export const LEGAL_CONTACT_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL || 'belloumi.karim.professional@gmail.com'
export const LEGAL_UPDATED_AT = '21 octobre 2026'

export interface LegalSection { title: string; body: React.ReactNode }

/**
 * Gabarit des pages légales (CGU, confidentialité). Le texte juridique est rédigé en français
 * (version faisant foi) ; en anglais et en arabe, un avertissement traduit l'indique.
 */
export async function LegalPage({ locale, title, intro, sections }: { locale: string; title: string; intro: React.ReactNode; sections: LegalSection[] }) {
  const t = await getTranslations({ locale, namespace: 'Legal' })
  return (
    <main className="min-h-screen bg-stone-50 text-stone-800">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <nav className="flex flex-wrap items-center justify-between gap-3 mb-8 text-sm">
          <Link href="/" className="font-black text-teal-700">BelloSuite</Link>
          <div className="flex gap-4">
            <Link href="/terms" className="text-stone-600 hover:text-teal-700">{t('terms')}</Link>
            <Link href="/privacy" className="text-stone-600 hover:text-teal-700">{t('privacy')}</Link>
          </div>
        </nav>
        {locale !== 'fr' && (
          <p role="note" className="mb-6 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            {t('french_only')}
          </p>
        )}
        <article lang="fr" dir="ltr" className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6 sm:p-10 space-y-8">
          <header className="space-y-2">
            <h1 className="text-2xl sm:text-3xl font-black text-stone-900">{title}</h1>
            <p className="text-xs text-stone-500">Dernière mise à jour : {LEGAL_UPDATED_AT}</p>
            <div className="text-sm leading-relaxed text-stone-700">{intro}</div>
          </header>
          {sections.map((s, i) => (
            <section key={i} className="space-y-2">
              <h2 className="text-lg font-black text-stone-900">{i + 1}. {s.title}</h2>
              <div className="text-sm leading-relaxed text-stone-700 space-y-2">{s.body}</div>
            </section>
          ))}
        </article>
        <p className="mt-8 text-center text-xs text-stone-500">
          {t('contact')} <a className="underline hover:text-teal-700" href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
        </p>
      </div>
    </main>
  )
}
