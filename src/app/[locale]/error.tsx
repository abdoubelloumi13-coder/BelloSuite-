'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { AlertTriangle } from 'lucide-react'

/** Erreur de rendu d'une page sous /[locale] : message traduit, bouton « Réessayer ». */
export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations('Common.states')
  useEffect(() => { console.error(error) }, [error])
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div role="alert" className="max-w-md w-full text-center bg-white border border-red-200 rounded-3xl shadow-sm p-10 space-y-4">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
        <h1 className="text-xl font-black text-stone-900">{t('error_title')}</h1>
        <p className="text-sm text-stone-500">{t('error_desc')}</p>
        {error.digest && <p className="text-xs text-stone-400 font-mono">{t('error_ref', { ref: error.digest })}</p>}
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <button onClick={() => reset()} className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold">{t('retry')}</button>
          <Link href="/dashboard" className="px-5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-sm font-bold">{t('go_dashboard')}</Link>
        </div>
      </div>
    </div>
  )
}
