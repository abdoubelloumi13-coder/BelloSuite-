import { useTranslations } from 'next-intl'

export default function LocaleLoading() {
  const t = useTranslations('Common')
  return (
    <div className="min-h-[60vh] flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
        <span className="text-sm text-stone-500">{t('loading')}</span>
      </div>
    </div>
  )
}
