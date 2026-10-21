'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/i18n/routing'
import { Plus, Folder, Users, Calendar, CheckSquare, ArrowRight } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useTranslations, useLocale } from 'next-intl'
import { readApiError } from '@/lib/client-errors'

export default function ProjectsPage() {
  const t = useTranslations('Projects')
  const locale = useLocale()
  const [projects, setProjects] = useState<any[]>([])
  const { tenantId } = useSession()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/projects`)
      .then(async r => {
        if (!r.ok) { setError(await readApiError(r, locale)); return [] }
        return r.json()
      })
      .then(data => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setError(t('load_error')))
      .finally(() => setLoading(false))
  }, [tenantId, locale, t])

  return (
    <div className="p-4 sm:p-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-stone-900 tracking-tight">{t('title')}</h1>
          <p className="text-stone-500 font-medium text-sm mt-1">{t('subtitle')}</p>
        </div>
        <Link href={`/projects/new`}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-sm transition-colors">
          <Plus className="w-4 h-4" /> {t('new')}
        </Link>
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" /></div>
      ) : projects.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-3xl border border-stone-200 shadow-sm">
          <Folder className="w-12 h-12 text-stone-300 mx-auto mb-4" />
          <p className="text-stone-700 font-bold">{t('empty_title')}</p>
          <p className="text-stone-500 text-sm mt-1">{t('empty_desc')}</p>
          <Link href="/projects/new" className="inline-flex items-center gap-2 mt-4 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-sm">
            <Plus className="w-4 h-4" /> {t('create')}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map(p => (
            <Link key={p.id} href={`/projects/${p.id}/kanban`}
              className="bg-white border border-stone-200 shadow-sm rounded-2xl p-6 hover:border-teal-500/50 transition-all group">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center">
                  <Folder className="w-5 h-5 text-teal-400" />
                </div>
                <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-teal-400 transition-colors" />
              </div>
              <h3 className="font-black text-stone-900 mb-1">{p.name}</h3>
              <p className="text-xs text-stone-500 line-clamp-2 mb-4">{p.description || t('no_description')}</p>
              <div className="flex items-center gap-4 text-stone-500 text-xs font-bold">
                <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {p._count?.members ?? p.members?.length ?? 0}</span>
                <span className="flex items-center gap-1"><CheckSquare className="w-3 h-3" /> {t('tasks_count', { count: p._count?.tasks || 0 })}</span>
                {(p.endDate || p.dueDate) && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {new Date(p.endDate || p.dueDate).toLocaleDateString(`${locale}-TN`, { day: 'numeric', month: 'short' })}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
