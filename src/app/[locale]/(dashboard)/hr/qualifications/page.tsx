'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Award, Plus, X, AlertTriangle, Pencil, Save } from 'lucide-react'
import { apiErrorMessage } from '@/lib/zod-helpers'

interface Qualification { id: string; code: string; designation: string; coefficient: number | string; salaryMin: number | string; salaryMax: number | string }
const empty = { code: '', designation: '', coefficient: '1', salaryMin: '', salaryMax: '' }

export default function QualificationsPage() {
  const t = useTranslations('HR.qualifications')
  const locale = useLocale()
  const [rows, setRows] = useState<Qualification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<typeof empty | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fmt = (v: number | string) => new Intl.NumberFormat(`${locale}-TN`, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(Number(v) || 0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/hr/qualifications')
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(apiErrorMessage(json, t('load_error'))); setRows([]); return }
      setRows(Array.isArray(json) ? json : [])
    } catch {
      setError(t('load_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const id = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  const startEdit = (q: Qualification) => {
    setError('')
    setEditId(q.id)
    setForm({ code: q.code, designation: q.designation, coefficient: String(Number(q.coefficient)), salaryMin: String(Number(q.salaryMin)), salaryMax: String(Number(q.salaryMax)) })
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    setError('')
    if (Number(form.salaryMax) > 0 && Number(form.salaryMax) < Number(form.salaryMin)) return setError(t('range_error'))
    setSaving(true)
    try {
      const res = await fetch('/api/hr/qualifications', {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editId ? { id: editId, ...form } : form),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) return setError(apiErrorMessage(json, t('save_error')))
      setForm(null)
      setEditId(null)
      await load()
    } catch {
      setError(t('save_error'))
    } finally {
      setSaving(false)
    }
  }

  const archive = async (id: string) => {
    const res = await fetch('/api/hr/qualifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, isActive: false }) })
    const json = await res.json().catch(() => null)
    if (!res.ok) return setError(apiErrorMessage(json, t('save_error')))
    setForm(null); setEditId(null)
    await load()
  }

  const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Award className="w-8 h-8 text-purple-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-gray-500 text-sm">{t('subtitle')}</p>
          </div>
        </div>
        <button onClick={() => { setError(''); setEditId(null); setForm(f => (f && !editId ? null : { ...empty })) }} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 text-white rounded-lg">
          {form && !editId ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {form && !editId ? t('cancel') : t('new')}
        </button>
      </div>

      {form && (
        <form onSubmit={save} className="bg-white border rounded-xl p-4 grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
          <label><span className={lbl}>{t('code')}</span><input className={input} value={form.code} disabled={!!editId} onChange={e => setForm({ ...form, code: e.target.value })} required /></label>
          <label className="md:col-span-2"><span className={lbl}>{t('designation')}</span><input className={input} value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} required /></label>
          <label><span className={lbl}>{t('coefficient')}</span><input type="number" min="0" step="0.01" className={input} value={form.coefficient} onChange={e => setForm({ ...form, coefficient: e.target.value })} /></label>
          <div className="hidden md:block" />
          <label><span className={lbl}>{t('salary_min')}</span><input type="number" min="0" step="0.001" className={input} value={form.salaryMin} onChange={e => setForm({ ...form, salaryMin: e.target.value })} /></label>
          <label><span className={lbl}>{t('salary_max')}</span><input type="number" min="0" step="0.001" className={input} value={form.salaryMax} onChange={e => setForm({ ...form, salaryMax: e.target.value })} /></label>
          <div className="md:col-span-3 flex flex-wrap gap-2 justify-end">
            {editId && <button type="button" onClick={() => archive(editId)} className="px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg">{t('archive')}</button>}
            {editId && <button type="button" onClick={() => { setForm(null); setEditId(null) }} className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg">{t('cancel')}</button>}
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-lg"><Save className="w-4 h-4" />{saving ? t('saving') : t('save')}</button>
          </div>
        </form>
      )}

      {error && <div role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}

      <div className="bg-white border rounded-xl overflow-x-auto">
        {loading ? <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div> : rows.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">{t('empty')}</div>
        ) : (
          <table className="w-full text-sm min-w-[600px]">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
              <tr><th className="px-4 py-2 text-start">{t('code')}</th><th className="px-4 py-2 text-start">{t('designation')}</th><th className="px-4 py-2 text-end">{t('coefficient')}</th><th className="px-4 py-2 text-end">{t('salary_range')}</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody>
              {rows.map(q => (
                <tr key={q.id} className="border-t">
                  <td className="px-4 py-2 font-mono text-purple-700">{q.code}</td>
                  <td className="px-4 py-2 text-gray-900">{q.designation}</td>
                  <td className="px-4 py-2 text-end text-gray-700">{Number(q.coefficient)}</td>
                  <td className="px-4 py-2 text-end text-gray-700">{fmt(q.salaryMin)} – {Number(q.salaryMax) > 0 ? fmt(q.salaryMax) : '∞'}</td>
                  <td className="px-4 py-2 text-end"><button onClick={() => startEdit(q)} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100" aria-label={t('edit')}><Pencil className="w-4 h-4" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
