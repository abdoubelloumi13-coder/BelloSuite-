'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { CalendarX, Clock, Plus, Check, X, Trash2, AlertTriangle } from 'lucide-react'
import { apiErrorMessage } from '@/lib/zod-helpers'
import { ABSENCE_TYPES, countAbsenceDays, lateMinutes } from '@/lib/hr-attendance'

interface Emp { id: string; firstName: string; lastName: string; employeeNumber: string; isActive?: boolean }
type Statut = 'EN_ATTENTE' | 'APPROUVE' | 'REJETE'
interface Absence {
  id: string; employee: Emp; dateDebut: string; dateFin: string; type: string
  joursCal: number; joursOuvres: number; justifie: boolean; statut: Statut; observations: string | null
}
interface Delay {
  id: string; employee: Emp; date: string; heureArrivee: string; heureNormale: string
  minutesRetard: number; justifie: boolean; motif: string | null; statut: Statut; sanction: string
}

const today = () => new Date().toISOString().slice(0, 10)
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export default function AttendancesPage() {
  const t = useTranslations('HR.attendance')
  const locale = useLocale()
  const [tab, setTab] = useState<'absences' | 'delays'>('absences')
  const [year, setYear] = useState(new Date().getFullYear())
  const [employees, setEmployees] = useState<Emp[]>([])
  const [absences, setAbsences] = useState<Absence[]>([])
  const [delays, setDelays] = useState<Delay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [absForm, setAbsForm] = useState({ employeeId: '', type: 'CONGE_PAYE', dateDebut: today(), dateFin: today(), justifie: false, observations: '' })
  const [delForm, setDelForm] = useState({ employeeId: '', date: today(), heureArrivee: '08:15', heureNormale: '08:00', justifie: false, motif: '' })

  const fmtDate = (d: string) => new Date(d).toLocaleDateString(`${locale}-TN`)
  const name = (e: Emp) => `${e.firstName} ${e.lastName}`.trim()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [ra, rd] = await Promise.all([fetch(`/api/hr/absences?year=${year}`), fetch(`/api/hr/delays?year=${year}`)])
      const [ja, jd] = await Promise.all([ra.json().catch(() => null), rd.json().catch(() => null)])
      if (!ra.ok) setError(apiErrorMessage(ja, t('load_error')))
      else if (!rd.ok) setError(apiErrorMessage(jd, t('load_error')))
      setAbsences(asArray<Absence>(ra.ok ? ja : []))
      setDelays(asArray<Delay>(rd.ok ? jd : []))
    } catch {
      setError(t('load_error'))
    } finally {
      setLoading(false)
    }
  }, [year, t])

  useEffect(() => {
    const id = setTimeout(() => { void load() }, 0)
    return () => clearTimeout(id)
  }, [load])

  useEffect(() => {
    fetch('/api/hr/employees').then(r => (r.ok ? r.json() : [])).then(d => {
      setEmployees(asArray<Emp>(d).filter(e => e.isActive !== false))
    }).catch(() => {})
  }, [])

  const absDays = countAbsenceDays(new Date(absForm.dateDebut), new Date(absForm.dateFin))
  const lateMin = lateMinutes(delForm.heureArrivee, delForm.heureNormale)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const body = tab === 'absences' ? absForm : delForm
    if (!body.employeeId) return setFormError(t('employee_required'))
    setSaving(true)
    try {
      const res = await fetch(tab === 'absences' ? '/api/hr/absences' : '/api/hr/delays', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) return setFormError(apiErrorMessage(json, t('save_error')))
      setShowForm(false)
      await load()
    } catch {
      setFormError(t('save_error'))
    } finally {
      setSaving(false)
    }
  }

  const act = async (kind: 'absences' | 'delays', id: string, statut: Statut | 'DELETE') => {
    setError('')
    const url = `/api/hr/${kind}` + (statut === 'DELETE' ? `?id=${id}` : '')
    const res = await fetch(url, statut === 'DELETE'
      ? { method: 'DELETE' }
      : { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, statut }) })
    const json = await res.json().catch(() => null)
    if (!res.ok) { setError(apiErrorMessage(json, t('save_error'))); return }
    await load()
  }

  const badge = (s: Statut) => (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${s === 'APPROUVE' ? 'bg-emerald-100 text-emerald-700' : s === 'REJETE' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
      {t(`status.${s}`)}
    </span>
  )
  const actions = (kind: 'absences' | 'delays', id: string, s: Statut) => s === 'EN_ATTENTE' ? (
    <div className="flex justify-end gap-1">
      <button onClick={() => act(kind, id, 'APPROUVE')} className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50" aria-label={t('approve')} title={t('approve')}><Check className="w-4 h-4" /></button>
      <button onClick={() => act(kind, id, 'REJETE')} className="p-1.5 rounded-lg text-red-600 hover:bg-red-50" aria-label={t('reject')} title={t('reject')}><X className="w-4 h-4" /></button>
      <button onClick={() => act(kind, id, 'DELETE')} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" aria-label={t('delete')} title={t('delete')}><Trash2 className="w-4 h-4" /></button>
    </div>
  ) : null

  const pendingAbs = absences.filter(a => a.statut === 'EN_ATTENTE').length
  const approvedDays = absences.filter(a => a.statut === 'APPROUVE').reduce((s, a) => s + a.joursOuvres, 0)
  const lateTotal = delays.filter(d => d.statut !== 'REJETE').reduce((s, d) => s + d.minutesRetard, 0)

  const input = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500 text-sm">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900" aria-label={t('year')}>
            {[0, 1, 2].map(d => new Date().getFullYear() - d).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button onClick={() => { setFormError(''); setShowForm(s => !s) }} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showForm ? t('cancel') : tab === 'absences' ? t('new_absence') : t('new_delay')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border rounded-xl p-4"><p className="text-xs text-gray-500">{t('kpi_pending')}</p><p className="text-2xl font-bold text-amber-600">{pendingAbs}</p></div>
        <div className="bg-white border rounded-xl p-4"><p className="text-xs text-gray-500">{t('kpi_days')}</p><p className="text-2xl font-bold text-gray-900">{approvedDays}</p></div>
        <div className="bg-white border rounded-xl p-4"><p className="text-xs text-gray-500">{t('kpi_late')}</p><p className="text-2xl font-bold text-gray-900">{lateTotal} min</p></div>
      </div>

      <div className="flex gap-2 border-b">
        {(['absences', 'delays'] as const).map(k => (
          <button key={k} onClick={() => { setTab(k); setShowForm(false) }} className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border-b-2 -mb-px ${tab === k ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {k === 'absences' ? <CalendarX className="w-4 h-4" /> : <Clock className="w-4 h-4" />} {t(`tab_${k}`)}
          </button>
        ))}
      </div>

      {showForm && (
        <form onSubmit={submit} className="bg-white border rounded-xl p-4 space-y-4">
          {employees.length === 0 && <p className="text-sm text-amber-700">{t('no_employee')}</p>}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <label className="md:col-span-2">
              <span className={lbl}>{t('employee')}</span>
              <select className={input} value={tab === 'absences' ? absForm.employeeId : delForm.employeeId}
                onChange={e => tab === 'absences' ? setAbsForm({ ...absForm, employeeId: e.target.value }) : setDelForm({ ...delForm, employeeId: e.target.value })}>
                <option value="">—</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.employeeNumber} — {name(e)}</option>)}
              </select>
            </label>
            {tab === 'absences' ? (
              <>
                <label className="md:col-span-2">
                  <span className={lbl}>{t('type')}</span>
                  <select className={input} value={absForm.type} onChange={e => setAbsForm({ ...absForm, type: e.target.value })}>
                    {ABSENCE_TYPES.map(ty => <option key={ty} value={ty}>{t(`types.${ty}`)}</option>)}
                  </select>
                </label>
                <label><span className={lbl}>{t('from')}</span><input type="date" className={input} value={absForm.dateDebut} onChange={e => setAbsForm({ ...absForm, dateDebut: e.target.value })} required /></label>
                <label><span className={lbl}>{t('to')}</span><input type="date" className={input} value={absForm.dateFin} onChange={e => setAbsForm({ ...absForm, dateFin: e.target.value })} required /></label>
                <label className="md:col-span-2"><span className={lbl}>{t('observations')}</span><input className={input} value={absForm.observations} onChange={e => setAbsForm({ ...absForm, observations: e.target.value })} /></label>
                <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={absForm.justifie} onChange={e => setAbsForm({ ...absForm, justifie: e.target.checked })} /> {t('justified')}</label>
                <p className="md:col-span-3 text-sm text-gray-600 self-center">
                  {absDays ? t('days_preview', { cal: absDays.joursCal, ouvr: absDays.joursOuvrables }) : <span className="text-red-600">{t('dates_invalid')}</span>}
                </p>
              </>
            ) : (
              <>
                <label><span className={lbl}>{t('date')}</span><input type="date" className={input} value={delForm.date} onChange={e => setDelForm({ ...delForm, date: e.target.value })} required /></label>
                <label><span className={lbl}>{t('arrival')}</span><input type="time" className={input} value={delForm.heureArrivee} onChange={e => setDelForm({ ...delForm, heureArrivee: e.target.value })} required /></label>
                <label><span className={lbl}>{t('normal_time')}</span><input type="time" className={input} value={delForm.heureNormale} onChange={e => setDelForm({ ...delForm, heureNormale: e.target.value })} required /></label>
                <label className="md:col-span-2"><span className={lbl}>{t('reason')}</span><input className={input} value={delForm.motif} onChange={e => setDelForm({ ...delForm, motif: e.target.value })} /></label>
                <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={delForm.justifie} onChange={e => setDelForm({ ...delForm, justifie: e.target.checked })} /> {t('justified')}</label>
                <p className="text-sm text-gray-600 self-center">{t('late_preview', { minutes: lateMin ?? 0 })}</p>
              </>
            )}
          </div>
          {formError && <div role="alert" className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{formError}</div>}
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">{saving ? t('saving') : t('save')}</button>
        </form>
      )}

      {error && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-white border rounded-xl overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">{t('loading')}</div>
        ) : tab === 'absences' ? (
          absences.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">{t('empty_absences')}</div> : (
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr><th className="px-4 py-2 text-start">{t('employee')}</th><th className="px-4 py-2 text-start">{t('type')}</th><th className="px-4 py-2 text-start">{t('period')}</th><th className="px-4 py-2 text-end">{t('days')}</th><th className="px-4 py-2 text-start">{t('status_label')}</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody>
                {absences.map(a => (
                  <tr key={a.id} className="border-t">
                    <td className="px-4 py-2 font-medium text-gray-900">{name(a.employee)}</td>
                    <td className="px-4 py-2 text-gray-700">{t.has(`types.${a.type}`) ? t(`types.${a.type}`) : a.type}{a.justifie ? ` · ${t('justified')}` : ''}</td>
                    <td className="px-4 py-2 text-gray-700">{fmtDate(a.dateDebut)} → {fmtDate(a.dateFin)}</td>
                    <td className="px-4 py-2 text-end text-gray-900">{a.joursOuvres}</td>
                    <td className="px-4 py-2">{badge(a.statut)}</td>
                    <td className="px-4 py-2">{actions('absences', a.id, a.statut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          delays.length === 0 ? <div className="p-8 text-center text-gray-500 text-sm">{t('empty_delays')}</div> : (
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr><th className="px-4 py-2 text-start">{t('employee')}</th><th className="px-4 py-2 text-start">{t('date')}</th><th className="px-4 py-2 text-start">{t('arrival')}</th><th className="px-4 py-2 text-end">{t('minutes')}</th><th className="px-4 py-2 text-start">{t('status_label')}</th><th className="px-4 py-2" /></tr>
              </thead>
              <tbody>
                {delays.map(d => (
                  <tr key={d.id} className="border-t">
                    <td className="px-4 py-2 font-medium text-gray-900">{name(d.employee)}</td>
                    <td className="px-4 py-2 text-gray-700">{fmtDate(d.date)}</td>
                    <td className="px-4 py-2 text-gray-700">{d.heureArrivee} / {d.heureNormale}{d.justifie ? ` · ${t('justified')}` : ''}</td>
                    <td className="px-4 py-2 text-end text-gray-900">{d.minutesRetard}</td>
                    <td className="px-4 py-2">{badge(d.statut)}</td>
                    <td className="px-4 py-2">{actions('delays', d.id, d.statut)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  )
}
