import { Suspense } from 'react'
import { cookies, headers } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { routing } from '@/i18n/routing'
import AuthCallbackInner from './AuthCallbackInner'

type Locale = (typeof routing.locales)[number]

/** Page hors [locale] : langue = ?locale, sinon cookie NEXT_LOCALE, sinon Accept-Language, sinon fr. */
async function resolveLocale(param?: string | string[]): Promise<Locale> {
  const isLocale = (v?: string | null): v is Locale => !!v && (routing.locales as readonly string[]).includes(v)
  const p = Array.isArray(param) ? param[0] : param
  if (isLocale(p)) return p
  const fromCookie = (await cookies()).get('NEXT_LOCALE')?.value
  if (isLocale(fromCookie)) return fromCookie
  const accept = (await headers()).get('accept-language') || ''
  const fromHeader = accept.split(',').map(s => s.trim().slice(0, 2).toLowerCase()).find(isLocale)
  return fromHeader ?? routing.defaultLocale
}

function LoadingState({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-10 shadow-2xl text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-teal-500/20">
          <span className="text-white font-black text-2xl">B</span>
        </div>
        <div className="w-12 h-12 border-2 border-teal-500/30 border-t-teal-400 rounded-full animate-spin mx-auto mb-4" />
        <h1 className="text-2xl font-black text-white mb-2">{label}</h1>
        <p className="text-zinc-500 text-sm">{sub}</p>
      </div>
    </div>
  )
}

export default async function AuthCallbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await resolveLocale((await searchParams).locale)
  const all = (await import(`../../../../../messages/${locale}.json`)).default as Record<string, Record<string, string>>
  const m = all.AuthCallback
  return (
    <NextIntlClientProvider locale={locale} messages={{ AuthCallback: m }}>
      <div dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
        <Suspense fallback={<LoadingState label={m.loading_title} sub={m.redirecting} />}>
          <AuthCallbackInner />
        </Suspense>
      </div>
    </NextIntlClientProvider>
  )
}
