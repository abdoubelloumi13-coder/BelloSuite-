import type { Metadata } from 'next'
import '../globals.css'
import { Cairo, Inter, IBM_Plex_Sans_Arabic } from 'next/font/google'
import { CookieConsentBanner } from '@/components/ui/CookieConsentBanner'
import { NotificationCenter } from '@/components/ui/NotificationCenter'
import { ApiErrorTranslator } from '@/components/providers/ApiErrorTranslator'
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing } from '@/i18n/routing';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  variable: '--font-cairo',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const ibmPlexArabic = IBM_Plex_Sans_Arabic({
  weight: ['100', '200', '300', '400', '500', '600', '700'],
  subsets: ['arabic'],
  variable: '--font-ibm-plex-arabic',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'BelloSuite — Stock, ventes et factures dans une seule application',
  description: 'Gérez votre stock, vos ventes, vos clients et vos factures depuis une seule application pensée pour les PME tunisiennes.',
  keywords: 'logiciel de facturation Tunisie, gestion de stock, devis, factures, PME tunisienne',
}

export default async function RootLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Ensure that the incoming `locale` is valid
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  // Providing all messages to the client
  // side is the easiest way to get started
  setRequestLocale(locale);
  const messages = await getMessages({ locale });
  
  const isRtl = locale === 'ar';

  return (
    <html lang={locale} dir={isRtl ? 'rtl' : 'ltr'} className={`${cairo.variable} ${inter.variable} ${ibmPlexArabic.variable} h-full`}>
      <body className={`h-full antialiased bg-zinc-50 text-zinc-900 ${isRtl ? 'font-arabic' : 'font-sans'}`}>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ApiErrorTranslator />
          {children}
          <CookieConsentBanner />
          <NotificationCenter />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
