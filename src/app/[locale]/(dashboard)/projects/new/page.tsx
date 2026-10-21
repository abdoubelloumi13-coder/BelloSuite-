'use client'

import { useState } from 'react'
import { Link, useRouter } from '@/i18n/routing'
import { ChevronLeft, FolderPlus, Loader2 } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { readApiError } from '@/lib/client-errors'

const STATUSES = ['DRAFT', 'ACTIVE', 'ON_HOLD'] as const
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
const COLORS = ['#0d9488', '#6366f1', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#0ea5e9', '#64748b']

/** Création d'un projet (POST /api/projects) puis redirection vers son tableau Kanban. */
export default function NewProjectPage() {
  const t = useTranslations('Projects.form')
  const locale = useLocale()
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('ACTIVE')
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>('MEDIUM')
  const [endDate, setEndDate] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function nameExists(n: string): Promise<boolean> {
    try {
      const r = await fetch('/api/projects')
      if (!r.ok) return false
      const list = await r.json()
      return Array.isArray(list) && list.some((p: { name?: string }) => (p.name || '').trim().toLowerCase() === n.toLowerCase())
    } catch { return false }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError(t('name_required')); return }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          status,
          priority,
          color,
          endDate: endDate ? new Date(endDate).toISOString() : null,
        }),
      })
      if (!res.ok) {
        // Nom unique par tenant (@@unique([tenantId, name])) : l'API renvoie alors une erreur générique.
        setError(res.status === 409 || (res.status >= 500 && await nameExists(name.trim())) ? t('name_taken') : await readApiError(res, locale))
        return
      }
      const project = await res.json()
      router.push(project?.id ? `/projects/${project.id}/kanban` : '/projects')
    } catch {
      setError(t('network_error'))
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full bg-white border border-stone-200 rounded-xl px-4 py-2.5 text-sm text-stone-900 focus:ring-2 focus:ring-teal-500 outline-none'

  return (
    <div className="p-4 sm:p-8 max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/projects" className="p-2 rounded-xl text-stone-500 hover:bg-stone-100" aria-label={t('back')}>
          <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
        </Link>
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight flex items-center gap-3">
            <FolderPlus className="w-7 h-7 text-teal-600" /> {t('title')}
          </h1>
          <p className="text-stone-500 text-sm mt-1">{t('subtitle')}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-white border border-stone-200 rounded-2xl shadow-sm p-6 space-y-5">
        {error && (
          <div role="alert" className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium">{error}</div>
        )}

        <div>
          <label htmlFor="p-name" className="block text-xs font-bold text-stone-500 uppercase mb-1.5">{t('name')} *</label>
          <input id="p-name" value={name} onChange={e => setName(e.target.value)} maxLength={120} required autoFocus
            placeholder={t('name_placeholder')} className={field} />
        </div>

        <div>
          <label htmlFor="p-desc" className="block text-xs font-bold text-stone-500 uppercase mb-1.5">{t('description')}</label>
          <textarea id="p-desc" value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder={t('description_placeholder')} className={`${field} resize-none`} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="p-status" className="block text-xs font-bold text-stone-500 uppercase mb-1.5">{t('status')}</label>
            <select id="p-status" value={status} onChange={e => setStatus(e.target.value as typeof status)} className={field}>
              {STATUSES.map(s => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-priority" className="block text-xs font-bold text-stone-500 uppercase mb-1.5">{t('priority')}</label>
            <select id="p-priority" value={priority} onChange={e => setPriority(e.target.value as typeof priority)} className={field}>
              {PRIORITIES.map(p => <option key={p} value={p}>{t(`priorities.${p}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-end" className="block text-xs font-bold text-stone-500 uppercase mb-1.5">{t('end_date')}</label>
            <input id="p-end" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <span className="block text-xs font-bold text-stone-500 uppercase mb-1.5">{t('color')}</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map(c => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c} aria-pressed={color === c}
                className={`w-8 h-8 rounded-full border-2 ${color === c ? 'border-stone-900 scale-110' : 'border-white'} shadow-sm transition-transform`}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 pt-2">
          <Link href="/projects" className="px-5 py-2.5 rounded-xl text-sm font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 text-center">{t('cancel')}</Link>
          <button type="submit" disabled={saving}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {t('submit')}
          </button>
        </div>
      </form>
    </div>
  )
}
