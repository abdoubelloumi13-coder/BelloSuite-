'use client'

import React, { useState, useEffect } from 'react'
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { useTranslations, useLocale } from 'next-intl'
import {
  Package,
  ShoppingCart,
  Users,
  LayoutDashboard,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Wallet,
  Wrench,
  Factory,
  Lock,
  ScanLine,
} from 'lucide-react'
import { NotificationBell } from '@/components/ui/NotificationBell'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { STOCK_NAV } from '@/components/stock/ui'

const MODULE_REGISTRY: Record<string, { tKey: string; icon: any; path: string; alwaysVisible?: boolean }> = {
  dashboard:   { tKey: 'Common.dashboard', icon: LayoutDashboard, path: '/dashboard', alwaysVisible: true },
  stock:       { tKey: 'Home.modules.stock.title', icon: Package, path: '/stock' },
  commercial:  { tKey: 'Home.modules.commercial.title', icon: ShoppingCart, path: '/commercial' },
  accounting:  { tKey: 'Home.modules.accounting.title', icon: Wallet, path: '/accounting/chart' },
  hr:          { tKey: 'Home.modules.hr.title', icon: Users, path: '/hr' },
  pos:         { tKey: 'Sidebar.pos', icon: ShoppingCart, path: '/pos' },
  gmao:        { tKey: 'Home.modules.maintenance.title', icon: Wrench, path: '/gmao' },
  gpao:        { tKey: 'Home.modules.production.title', icon: Factory, path: '/gpao' },
}

const MODULE_ORDER = ['dashboard', 'stock', 'commercial', 'accounting', 'hr', 'pos', 'gmao', 'gpao']

export default function Sidebar() {
  const t = useTranslations()
  const locale = useLocale()
  const isRtl = locale === 'ar'
  const pathname = usePathname()
  const router = useRouter()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [enabledModuleNames, setEnabledModuleNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setUser(data)
          // Fetch modules using tenantId from session
          if (data.tenantId) {
            fetch(`/api/tenant/modules?tenantId=${data.tenantId}`)
              .then(r => r.ok ? r.json() : [])
              .then((names: string[]) => setEnabledModuleNames(names))
              .catch(() => setEnabledModuleNames([]))
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'DELETE' })
    router.push('/login')
  }

  const sidebarItems = MODULE_ORDER.map(key => {
    const config = MODULE_REGISTRY[key]
    const isEnabled = config.alwaysVisible || enabledModuleNames.includes(key)
    return { ...config, key, isEnabled }
  }).filter(m => m.isEnabled || m.alwaysVisible === true)

  const lockedItems = MODULE_ORDER
    .filter(key => !MODULE_REGISTRY[key].alwaysVisible && !enabledModuleNames.includes(key))
    .map(key => MODULE_REGISTRY[key])

  return (
    <aside className={`bg-zinc-950 border-e border-zinc-800/50 flex flex-col transition-all duration-500 ease-in-out h-screen sticky top-0 z-[60] ${isCollapsed ? 'w-20' : 'w-72'}`}>
      <div className="p-6 flex items-center justify-between shrink-0">
        {!isCollapsed && (
          <div className="flex items-center gap-3 animate-in fade-in slide-in-from-start duration-500">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <span className="text-white font-black text-xl">B</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-wide">BelloSuite</h1>
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{t('Sidebar.smart_erp')}</p>
            </div>
          </div>
        )}
        {isCollapsed && (
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center mx-auto shadow-lg shadow-teal-500/20">
            <span className="text-white font-black text-xl">B</span>
          </div>
        )}
        <button onClick={() => setIsCollapsed(!isCollapsed)} aria-label={t('Sidebar.toggle')} className="p-2 hover:bg-zinc-900 rounded-xl text-zinc-400 transition-colors hidden sm:block ms-2">
          {isCollapsed ? (isRtl ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />) : (isRtl ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />)}
        </button>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`h-12 bg-zinc-900 rounded-2xl animate-pulse opacity-30 ${isCollapsed ? 'w-12 mx-auto' : ''}`} />
          ))
        ) : (
          <>
            {sidebarItems.map((module) => {
              const isActive = (pathname === module.path || (module.path !== '/dashboard' && pathname.startsWith(module.path))) && !(module.key === 'commercial' && pathname.startsWith('/commercial/scan'))
              return (
                <React.Fragment key={module.key}>
                <Link href={module.path} className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group relative overflow-hidden ${isActive ? 'bg-teal-500/10 text-teal-400 shadow-[inset_0_0_12px_rgba(20,184,166,0.1)]' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'}`}>
                  {isActive && <div className="absolute start-0 w-1.5 h-6 bg-teal-500 rounded-e-full transition-all" />}
                  <module.icon className={`w-5 h-5 flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${isActive ? 'text-teal-400' : ''}`} />
                  {!isCollapsed && <span className="font-semibold text-sm tracking-wide grow animate-in fade-in slide-in-from-start duration-300">{t(module.tKey as any)}</span>}
                </Link>
                {module.key === 'commercial' && (() => {
                  const scanActive = pathname === '/commercial/scan' || pathname.startsWith('/commercial/scan/')
                  return (
                    <Link href="/commercial/scan" title={t('Sidebar.scan_document')} className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all group relative overflow-hidden ${scanActive ? 'bg-teal-500/10 text-teal-400' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'}`}>
                      {scanActive && <div className="absolute start-0 w-1.5 h-6 bg-teal-500 rounded-e-full transition-all" />}
                      <ScanLine className={`w-5 h-5 flex-shrink-0 transition-transform duration-300 group-hover:scale-110 ${scanActive ? 'text-teal-400' : ''}`} />
                      {!isCollapsed && <span className="font-semibold text-sm tracking-wide grow animate-in fade-in slide-in-from-start duration-300">{t('Sidebar.scan_document')}</span>}
                    </Link>
                  )
                })()}
                {module.key === 'stock' && isActive && !isCollapsed && (
                  <div className="mt-1 mb-2 ms-6 ps-3 border-s border-zinc-800 space-y-0.5">
                    {STOCK_NAV.filter(item => item.href !== '/stock').map(item => {
                      const subActive = pathname === item.href || pathname.startsWith(item.href + '/')
                      return (
                        <Link key={item.href} href={item.href} className={`block px-3 py-1.5 rounded-xl text-[13px] transition-colors ${subActive ? 'text-teal-400 bg-teal-500/10 font-semibold' : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-900/50'}`}>
                          {t(`StockMod.${item.key}`)}
                        </Link>
                      )
                    })}
                  </div>
                )}
                </React.Fragment>
              )
            })}
            {lockedItems.length > 0 && !isCollapsed && (
              <div className="pt-3">
                <p className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-700 px-4 mb-2">{t('Sidebar.unsubscribed')}</p>
                {lockedItems.map((module) => (
                  <div key={module.path} title={t('Sidebar.locked_title', { name: t(module.tKey as any) })} className="flex items-center gap-3 px-4 py-3 rounded-2xl text-zinc-700 opacity-50 cursor-not-allowed select-none">
                    <module.icon className="w-5 h-5 flex-shrink-0" />
                    <span className="font-semibold text-sm tracking-wide grow">{t(module.tKey as any)}</span>
                    <Lock className="w-3 h-3 flex-shrink-0" />
                  </div>
                ))}
              </div>
            )}
            {isCollapsed && lockedItems.length > 0 && (
              <div className="pt-2 border-t border-zinc-800/30 mt-2 space-y-1">
                {lockedItems.map((module) => (
                  <div key={module.path} className="flex items-center justify-center p-3 rounded-2xl text-zinc-800 cursor-not-allowed">
                    <module.icon className="w-5 h-5" />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </nav>

      <div className="p-4 border-t border-zinc-800/50 space-y-4 shrink-0">
        <div className="flex items-center justify-center gap-2"><LanguageSwitcher /></div>
        <div className="flex items-center justify-center"><NotificationBell /></div>
        {!isCollapsed && user && (
          <div className="bg-zinc-900/50 rounded-2xl p-4 animate-in fade-in slide-in-from-bottom duration-500">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-zinc-800 border-2 border-teal-500/30 flex items-center justify-center overflow-hidden flex-shrink-0">
                <img src={`https://api.dicebear.com/7.x/initials/svg?seed=${user.email}`} alt={t('Sidebar.avatar_alt')} />
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-bold text-white truncate">{user.firstName || user.email?.split('@')[0]}</p>
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest truncate">{user.role}</p>
              </div>
            </div>
            <button onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-800 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 rounded-xl transition-all font-bold text-xs">
              <LogOut className="w-4 h-4" /> {t('Sidebar.logout')}
            </button>
          </div>
        )}
        {isCollapsed && (
          <button onClick={handleLogout} className="w-10 h-10 mx-auto flex items-center justify-center bg-zinc-900 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 rounded-xl transition-all">
            <LogOut className="w-5 h-5" />
          </button>
        )}
      </div>
    </aside>
  )
}