'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, X, ChevronRight, Building2, User, Mail, Globe } from 'lucide-react'
import { useTranslations } from 'next-intl'
import SmartInput from '@/components/ui/SmartInput'
import type { Suggestion } from '@/components/ui/SmartInput'

interface GlobalSearchResult {
  tenants: any[]
  users: any[]
}

export default function GlobalSearch({ onTenantSelect, onUserSelect }: { onTenantSelect: (id: string) => void; onUserSelect: (id: string) => void }) {
  const t = useTranslations('SuperAdmin.globalSearch')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GlobalSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [showResults, setShowResults] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (query.length < 2) {
      setResults(null)
      setShowResults(false)
      return
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/super-admin/search?query=${encodeURIComponent(query)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data)
          setShowResults(true)
        }
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [query])

  const handleSelectTenant = (id: string) => {
    onTenantSelect(id)
    setShowResults(false)
    setQuery('')
  }

  const handleSelectUser = (id: string) => {
    onUserSelect(id)
    setShowResults(false)
    setQuery('')
  }

  const clearQuery = () => {
    setQuery('')
    setResults(null)
    setShowResults(false)
  }

  if (!showResults || !results) {
    return (
      <div className="relative" ref={containerRef}>
        <div className="relative">
          <Search className="w-4 h-4 absolute start-4 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setShowResults(true) }}
            placeholder={t('placeholder')}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl ps-11 pe-4 py-3 text-sm text-white outline-none focus:border-emerald-500 transition-all"
            autoComplete="off"
          />
          {query && (
            <button onClick={clearQuery} className="absolute end-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    )
  }

  const totalResults = (results.tenants?.length || 0) + (results.users?.length || 0)

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        <Search className="w-4 h-4 absolute start-4 top-1/2 -translate-y-1/2 text-emerald-500" />
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setShowResults(true) }}
          placeholder={t('placeholder')}
          className="w-full bg-zinc-900 border border-emerald-500/30 rounded-2xl ps-11 pe-4 py-3 text-sm text-white outline-none focus:border-emerald-500 transition-all"
          autoComplete="off"
        />
        <button onClick={clearQuery} className="absolute end-3 top-1/2 -translate-y-1/2 p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="absolute z-50 mt-1 w-full min-w-[380px] max-w-md bg-white border border-zinc-200 rounded-2xl shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-700">{t('results', { count: totalResults })}</span>
          {loading && <span className="text-xs text-emerald-500 animate-pulse">{t('searching')}</span>}
        </div>

        {results.tenants && results.tenants.length > 0 && (
          <div>
            <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-100">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('section_tenants')}</span>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {results.tenants.slice(0, 5).map((t: any) => (
                <button
                  key={t.id}
                  onClick={() => handleSelectTenant(t.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-zinc-100 flex items-center justify-center font-black text-emerald-600 border border-zinc-200 text-sm">
                    {t.name?.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-zinc-900 text-sm truncate">{t.name}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <Globe className="w-3 h-3" /> {t.subdomain}.bellosuite.tn
                      {t.userCount && <span className="text-emerald-600">· {t.userCount} users</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        {results.users && results.users.length > 0 && (
          <div>
            <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-100">
              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('section_users')}</span>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {results.users.slice(0, 5).map((u: any) => (
                <button
                  key={u.id}
                  onClick={() => handleSelectUser(u.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-zinc-100 flex items-center justify-center font-black text-blue-600 border border-zinc-200 text-sm">
                    {(u.firstName?.charAt(0) || u.email?.charAt(0)).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-zinc-900 text-sm truncate">{u.firstName || ''} {u.lastName || ''}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                      <Mail className="w-3 h-3" /> {u.email}
                      {u.tenant && <span>· {u.tenant.name}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="px-4 py-3 border-t border-zinc-100 text-center">
          <p className="text-[10px] text-zinc-500">{t('continue_typing')}</p>
        </div>
      </div>
    </div>
  )
}