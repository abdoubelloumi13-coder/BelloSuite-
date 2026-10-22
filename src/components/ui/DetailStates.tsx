'use client'

import { Loader2, AlertTriangle, SearchX } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { useTranslations } from 'next-intl'

/** États communs des pages de détail : chargement, erreur, introuvable. */
export function DetailLoading() {
  return (
    <div className="flex justify-center items-center py-24" role="status">
      <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
    </div>
  )
}

export function DetailError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTranslations('Common.states')
  return (
    <div role="alert" className="max-w-xl mx-auto my-16 p-6 bg-red-50 border border-red-200 rounded-2xl text-center space-y-3">
      <AlertTriangle className="w-8 h-8 text-red-500 mx-auto" />
      <p className="text-red-700 font-medium">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="px-4 py-2 rounded-xl bg-white border border-red-200 text-red-700 text-sm font-bold hover:bg-red-100">{t('retry')}</button>
      )}
    </div>
  )
}

export function DetailNotFound({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  const t = useTranslations('Common.states')
  return (
    <div className="max-w-xl mx-auto my-16 p-6 bg-white border border-stone-200 rounded-2xl text-center space-y-3">
      <SearchX className="w-8 h-8 text-stone-400 mx-auto" />
      <p className="text-stone-700 font-bold">{t('not_found')}</p>
      <Link href={backHref} className="inline-block px-4 py-2 rounded-xl bg-teal-600 text-white text-sm font-bold hover:bg-teal-500">{backLabel}</Link>
    </div>
  )
}

/** Ligne libellé / valeur d'une fiche. */
export function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-2.5 border-b border-stone-100 last:border-0">
      <dt className="text-xs font-bold text-stone-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm font-medium text-stone-900 sm:text-end break-words">{value ?? '—'}</dd>
    </div>
  )
}
