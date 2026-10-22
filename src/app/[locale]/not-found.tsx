import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { SearchX } from 'lucide-react'

export default function LocaleNotFound() {
  const t = useTranslations('Common.states')
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-stone-50">
      <div className="max-w-md w-full text-center bg-white border border-stone-200 rounded-3xl shadow-sm p-10 space-y-4">
        <SearchX className="w-12 h-12 text-teal-600 mx-auto" />
        <p className="text-5xl font-black text-stone-900">404</p>
        <h1 className="text-xl font-black text-stone-900">{t('page_not_found_title')}</h1>
        <p className="text-sm text-stone-500">{t('page_not_found_desc')}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
          <Link href="/dashboard" className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-bold">{t('go_dashboard')}</Link>
          <Link href="/" className="px-5 py-2.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 text-sm font-bold">{t('go_home')}</Link>
        </div>
      </div>
    </main>
  )
}
