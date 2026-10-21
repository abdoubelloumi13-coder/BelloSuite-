'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { Settings, Users, FileCheck2, Calendar, BookOpen, Warehouse, CheckCircle2, ArrowRight } from 'lucide-react'
import { useSession } from '@/hooks/useSession'

const LINKS = [
  { href: '/users', key: 'users', icon: Users },
  { href: '/commercial/settings/ttn', key: 'einvoice', icon: FileCheck2 },
  { href: '/accounting/periods', key: 'periods', icon: Calendar },
  { href: '/accounting/chart', key: 'chart', icon: BookOpen },
  { href: '/stock/settings', key: 'stock', icon: Warehouse },
] as const

export default function SettingsPage() {
  const t = useTranslations('Settings')
  const tm = useTranslations('Home.modules')
  const { tenantId } = useSession()
  const [modules, setModules] = useState<string[] | null>(null)

  useEffect(() => {
    if (!tenantId) return
    fetch(`/api/tenant/modules?tenantId=${encodeURIComponent(tenantId)}`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => setModules(Array.isArray(d) ? d : []))
      .catch(() => setModules([]))
  }, [tenantId])

  const moduleTitle = (m: string) => {
    const key = m === 'gmao' ? 'maintenance' : m === 'gpao' ? 'production' : m
    return tm.has(`${key}.title`) ? tm(`${key}.title` as 'stock.title') : m
  }

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-teal-500/10 rounded-2xl"><Settings className="w-6 h-6 text-teal-500" /></div>
        <div>
          <h1 className="text-3xl font-black text-stone-900 dark:text-white">{t('title')}</h1>
          <p className="text-stone-500 text-sm font-medium">{t('subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {LINKS.map(l => (
          <Link key={l.href} href={l.href} className="group flex items-start gap-4 p-5 rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 hover:border-teal-400 transition-all">
            <div className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-500/10 text-teal-600"><l.icon className="w-5 h-5" /></div>
            <div className="flex-1 text-start">
              <p className="font-bold text-stone-900 dark:text-white">{t(`links.${l.key}.title`)}</p>
              <p className="text-xs text-stone-500 mt-1">{t(`links.${l.key}.desc`)}</p>
            </div>
            <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-teal-600 rtl:rotate-180" />
          </Link>
        ))}
      </div>

      <section className="p-6 rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40">
        <h2 className="font-black text-stone-900 dark:text-white mb-1">{t('modules_title')}</h2>
        <p className="text-xs text-stone-500 mb-4">{t('modules_hint')}</p>
        {modules === null ? (
          <div className="h-10 bg-stone-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
        ) : modules.length === 0 ? (
          <p className="text-sm text-stone-500">{t('modules_none')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {modules.map(m => (
              <li key={m} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-semibold">
                <CheckCircle2 className="w-4 h-4" /> {moduleTitle(m)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
