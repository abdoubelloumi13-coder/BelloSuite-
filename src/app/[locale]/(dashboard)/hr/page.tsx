'use client'
import { Link } from '@/i18n/routing'
import { Users, Wallet, Calendar, Award } from 'lucide-react'
import { useTranslations } from 'next-intl'

// Classes Tailwind écrites en entier (les classes construites dynamiquement ne sont pas générées)
const MODULES = [
  { href: '/hr/employees', icon: Users, key: 'employees', icon_cls: 'text-emerald-400', hover: 'hover:border-emerald-500/30' },
  { href: '/hr/paie', icon: Wallet, key: 'payroll', icon_cls: 'text-amber-400', hover: 'hover:border-amber-500/30' },
  { href: '/hr/attendances', icon: Calendar, key: 'attendance', icon_cls: 'text-blue-400', hover: 'hover:border-blue-500/30' },
  { href: '/hr/qualifications', icon: Award, key: 'evaluations', icon_cls: 'text-purple-400', hover: 'hover:border-purple-500/30' },
]

export default function HRDashboard() {
  const t = useTranslations('HR.home')
  return (
    <div className="p-4 sm:p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-black text-white">{t('title')}</h1>
        <p className="text-zinc-500 mt-1">{t('subtitle')}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {MODULES.map(m => (
          <Link key={m.href} href={m.href} className={`group bg-zinc-900/40 border border-zinc-800/50 rounded-[2rem] p-8 transition-all ${m.hover}`}>
            <m.icon className={`w-10 h-10 mb-4 ${m.icon_cls}`} />
            <h3 className="text-xl font-black text-white">{t(`modules.${m.key}.label`)}</h3>
            <p className="text-zinc-500 text-sm mt-1">{t(`modules.${m.key}.desc`)}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
