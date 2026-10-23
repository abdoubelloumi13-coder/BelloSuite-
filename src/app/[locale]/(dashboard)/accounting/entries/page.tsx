'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { FileText, Plus, Trash2, Save, Filter, ChevronDown, ChevronRight, AlertTriangle, X, CheckCircle2, Lock } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { apiErrorMessage } from '@/lib/zod-helpers'
import { entryTotals, validateEntryLines } from '@/lib/journal-entry-logic'

interface Journal { id: string; code: string; name: string }
interface Period { id: string; name: string; startDate: string; endDate: string; isClosed: boolean }
interface Account { id: string; accountNumber: string; name: string }
interface EntryLine { id: string; debit: number; credit: number; description: string | null; account: Account }
interface Entry {
  id: string
  entryNumber: string
  date: string
  description: string
  reference: string | null
  isPosted: boolean
  journal: Journal
  period: { id: string; name: string; isClosed: boolean }
  lines: EntryLine[]
  totalDebit: number
  totalCredit: number
}
interface FormLine { accountId: string; debit: string; credit: string; description: string }

const emptyLine = (): FormLine => ({ accountId: '', debit: '', credit: '', description: '' })
const today = () => new Date().toISOString().slice(0, 10)
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export default function JournalEntriesPage() {
  const t = useTranslations('Accounting.entries')
  const locale = useLocale()
  const { tenantId } = useSession()

  const [journals, setJournals] = useState<Journal[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [filterJournal, setFilterJournal] = useState('')
  const [filterPeriod, setFilterPeriod] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ journalId: '', date: today(), description: '', reference: '' })
  const [lines, setLines] = useState<FormLine[]>([emptyLine(), emptyLine()])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [actionMsg, setActionMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [acting, setActing] = useState(false)

  const fmt = (v: number) =>
    new Intl.NumberFormat(`${locale}-TN`, { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v || 0)

  // Référentiels : journaux, exercices, comptes
  useEffect(() => {
    if (!tenantId) return
    const q = `tenantId=${encodeURIComponent(tenantId)}`
    const get = (url: string) => fetch(url).then(r => (r.ok ? r.json() : [])).catch(() => [])
    Promise.all([get(`/api/accounting/journals?${q}`), get(`/api/accounting/periods?${q}`), get(`/api/accounting/accounts?${q}`)])
      .then(([j, p, a]) => {
        setJournals(asArray<Journal>(j))
        setPeriods(asArray<Period>(p))
        setAccounts(asArray<Account>(a))
      })
  }, [tenantId])

  const fetchEntries = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setLoadError('')
    try {
      const params = new URLSearchParams({ tenantId })
      if (filterJournal) params.set('journalId', filterJournal)
      if (filterPeriod) params.set('periodId', filterPeriod)
      const res = await fetch(`/api/accounting/entries?${params}`)
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setEntries([])
        setLoadError(apiErrorMessage(json, t('load_error')))
      } else {
        setEntries(asArray<Entry>(json))
      }
    } catch {
      setLoadError(t('load_error'))
    } finally {
      setLoading(false)
    }
  }, [tenantId, filterJournal, filterPeriod, t])

  useEffect(() => {
    // chargement initial / changement de filtre (fetch asynchrone, pas de setState synchrone)
    const id = setTimeout(() => { void fetchEntries() }, 0)
    return () => clearTimeout(id)
  }, [fetchEntries])

  const numericLines = useMemo(
    () => lines.map(l => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description })),
    [lines]
  )
  const totals = entryTotals(numericLines)
  const diff = Math.round((totals.debit - totals.credit) * 1000) / 1000
  const balanced = totals.debit > 0 && Math.abs(diff) < 0.001

  const updateLine = (i: number, patch: Partial<FormLine>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const openForm = () => {
    setFormError('')
    setForm(f => ({ ...f, journalId: f.journalId || journals[0]?.id || '' }))
    setShowForm(true)
  }
  const closeForm = () => {
    setFormError('')
    setShowForm(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.journalId) return setFormError(t('errors.journal_required'))
    if (!form.description.trim()) return setFormError(t('errors.description_required'))
    const used = numericLines.filter(l => l.debit || l.credit)
    const err = validateEntryLines(used)
    if (err) return setFormError(err)

    setSaving(true)
    try {
      const res = await fetch('/api/accounting/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, tenantId, lines: used }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setFormError(apiErrorMessage(json, t('errors.save')))
        return
      }
      setForm({ journalId: form.journalId, date: form.date, description: '', reference: '' })
      setLines([emptyLine(), emptyLine()])
      setShowForm(false)
      await fetchEntries()
    } catch {
      setFormError(t('errors.save'))
    } finally {
      setSaving(false)
    }
  }

  const drafts = entries.filter(e => !e.isPosted && !e.period?.isClosed)
  const toggleSelect = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const validateSelected = async () => {
    if (!selected.size) return
    setActing(true)
    setActionMsg(null)
    try {
      const res = await fetch('/api/accounting/entries/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected] }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setActionMsg({ ok: false, text: apiErrorMessage(json, t('validate_error')) }); return }
      const errs: { entryNumber?: string; error: string }[] = json?.errors ?? []
      setActionMsg({
        ok: errs.length === 0,
        text: [t('validated_count', { count: json?.validated ?? 0 }), ...errs.map(e => `${e.entryNumber ?? ''} : ${e.error}`)].join(' — '),
      })
      setSelected(new Set())
      await fetchEntries()
    } catch {
      setActionMsg({ ok: false, text: t('validate_error') })
    } finally {
      setActing(false)
    }
  }

  const deleteDraft = async (id: string) => {
    if (!window.confirm(t('delete_confirm'))) return
    setActing(true)
    setActionMsg(null)
    try {
      const res = await fetch(`/api/accounting/entries/${id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setActionMsg({ ok: false, text: apiErrorMessage(json, t('delete_error')) }); return }
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n })
      await fetchEntries()
    } catch {
      setActionMsg({ ok: false, text: t('delete_error') })
    } finally {
      setActing(false)
    }
  }

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const inputCls = 'bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500'

  return (
    <div className="p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-teal-500/10 rounded-2xl"><FileText className="w-6 h-6 text-teal-400" /></div>
          <div>
            <h1 className="text-3xl font-black text-white">{t('title')}</h1>
            <p className="text-zinc-500 text-sm font-medium">{t('subtitle')}</p>
          </div>
        </div>
        <button onClick={showForm ? closeForm : openForm} className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-sm">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? t('cancel') : t('new')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-zinc-900/40 border border-zinc-800/50 rounded-[1.5rem] p-6 space-y-4">
          {journals.length === 0 && (
            <p className="text-amber-400 text-sm font-bold">{t('no_journal_hint')}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <label className="space-y-1">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('journal')}</span>
              <select value={form.journalId} onChange={e => setForm({ ...form, journalId: e.target.value })} className={`${inputCls} w-full`}>
                <option value="">—</option>
                {journals.map(j => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('date')}</span>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className={`${inputCls} w-full`} required />
            </label>
            <label className="space-y-1 md:col-span-1">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('reference')}</span>
              <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} className={`${inputCls} w-full`} />
            </label>
            <label className="space-y-1 md:col-span-1">
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('description')}</span>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={`${inputCls} w-full`} required />
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">
                  <th className="py-2 text-start">{t('account')}</th>
                  <th className="py-2 text-start">{t('line_label')}</th>
                  <th className="py-2 text-end">{t('debit')}</th>
                  <th className="py-2 text-end">{t('credit')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-t border-zinc-800/50">
                    <td className="py-2 pe-2">
                      <select value={l.accountId} onChange={e => updateLine(i, { accountId: e.target.value })} className={`${inputCls} w-full min-w-[220px]`}>
                        <option value="">—</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.accountNumber} — {a.name}</option>)}
                      </select>
                    </td>
                    <td className="py-2 pe-2"><input value={l.description} onChange={e => updateLine(i, { description: e.target.value })} className={`${inputCls} w-full`} /></td>
                    <td className="py-2 pe-2"><input type="number" min="0" step="0.001" inputMode="decimal" value={l.debit} onChange={e => updateLine(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} className={`${inputCls} w-32 text-end`} /></td>
                    <td className="py-2 pe-2"><input type="number" min="0" step="0.001" inputMode="decimal" value={l.credit} onChange={e => updateLine(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} className={`${inputCls} w-32 text-end`} /></td>
                    <td className="py-2">
                      <button type="button" disabled={lines.length <= 2} onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} className="p-2 text-zinc-500 hover:text-red-400 disabled:opacity-30" aria-label={t('remove_line')}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-zinc-700 font-black">
                  <td className="py-3">
                    <button type="button" onClick={() => setLines(prev => [...prev, emptyLine()])} className="flex items-center gap-1 text-teal-400 text-xs font-bold">
                      <Plus className="w-3 h-3" /> {t('add_line')}
                    </button>
                  </td>
                  <td className="py-3 text-end text-zinc-400 text-xs uppercase">{t('totals')}</td>
                  <td className="py-3 text-end text-white font-mono">{fmt(totals.debit)}</td>
                  <td className="py-3 text-end text-white font-mono">{fmt(totals.credit)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className={`text-sm font-bold ${balanced ? 'text-emerald-400' : 'text-amber-400'}`}>
            {balanced ? t('balanced') : t('unbalanced', { diff: fmt(Math.abs(diff)) })}
          </div>

          {formError && (
            <div role="alert" className="flex items-start gap-2 px-4 py-3 rounded-2xl text-sm font-bold bg-red-500/10 text-red-400 border border-red-500/20">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {formError}
            </div>
          )}

          <button type="submit" disabled={saving || !balanced} className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-700 text-white rounded-xl font-bold text-sm">
            <Save className="w-4 h-4" /> {saving ? t('saving') : t('save')}
          </button>
        </form>
      )}

      {/* Filtres */}
      <div className="bg-zinc-900/40 border border-zinc-800/50 rounded-[1.5rem] p-4 flex flex-wrap gap-4 items-end">
        <Filter className="w-4 h-4 text-zinc-500 mb-3" />
        <label className="space-y-1">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('journal')}</span>
          <select value={filterJournal} onChange={e => setFilterJournal(e.target.value)} className={`${inputCls} min-w-[180px]`}>
            <option value="">{t('all_journals')}</option>
            {journals.map(j => <option key={j.id} value={j.id}>{j.code} — {j.name}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">{t('period')}</span>
          <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)} className={`${inputCls} min-w-[180px]`}>
            <option value="">{t('all_periods')}</option>
            {periods.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      {loadError && (
        <div role="alert" className="px-4 py-3 rounded-2xl text-sm font-bold bg-red-500/10 text-red-400 border border-red-500/20">{loadError}</div>
      )}

      {drafts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setSelected(new Set(drafts.map(d => d.id)))} className="px-4 py-2 rounded-xl text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300">
            {t('select_drafts')}
          </button>
          <button onClick={validateSelected} disabled={!selected.size || acting} className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white">
            <CheckCircle2 className="w-4 h-4" /> {t('validate_selected', { count: selected.size })}
          </button>
          <span className="text-xs text-zinc-500">{t('posted_hint')}</span>
        </div>
      )}

      {actionMsg && (
        <div role="status" className={`px-4 py-3 rounded-2xl text-sm font-bold border ${actionMsg.ok ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>{actionMsg.text}</div>
      )}

      {loading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <div key={i} className="h-16 bg-zinc-900 rounded-2xl animate-pulse opacity-40" />)}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-zinc-500">
          <FileText className="w-14 h-14 mx-auto mb-4 opacity-30" />
          <p className="font-bold text-lg">{t('empty_title')}</p>
          <p className="text-sm mt-1">{t('empty_desc')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map(entry => {
            const open = expanded.has(entry.id)
            return (
              <div key={entry.id} className="bg-zinc-900/40 border border-zinc-800/50 rounded-2xl overflow-hidden">
                <div className="flex items-center">
                {!entry.isPosted && !entry.period?.isClosed ? (
                  <input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggleSelect(entry.id)} className="ms-4 w-4 h-4 accent-emerald-500" aria-label={t('select_drafts')} />
                ) : <span className="ms-4 w-4" />}
                <button onClick={() => toggle(entry.id)} className="flex-1 min-w-0 flex flex-wrap items-center gap-4 p-4 hover:bg-zinc-800/30 text-start">
                  {open ? <ChevronDown className="w-4 h-4 text-zinc-500" /> : <ChevronRight className="w-4 h-4 text-zinc-500 rtl:rotate-180" />}
                  <span className="font-mono text-xs text-zinc-400">{new Date(entry.date).toLocaleDateString(`${locale}-TN`)}</span>
                  <span className="font-mono text-xs text-amber-400">{entry.entryNumber}</span>
                  <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400">{entry.journal?.code}</span>
                  <span className="text-sm text-white font-bold grow truncate">{entry.description}</span>
                  <span className={`text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 ${entry.isPosted ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                    {entry.isPosted && <Lock className="w-3 h-3" />}{entry.isPosted ? t('posted') : t('draft')}
                  </span>
                  <span className="font-mono text-sm text-white">{fmt(entry.totalDebit)}</span>
                </button>
                {!entry.isPosted && !entry.period?.isClosed && (
                  <button onClick={() => deleteDraft(entry.id)} disabled={acting} className="p-3 me-2 text-zinc-500 hover:text-red-400 disabled:opacity-30" aria-label={t('delete_draft')}>
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                </div>
                {open && (
                  <table className="w-full text-sm border-t border-zinc-800/50">
                    <tbody>
                      {entry.lines.map(l => (
                        <tr key={l.id} className="border-t border-zinc-800/30">
                          <td className="px-5 py-2 font-mono text-amber-400 text-xs">{l.account?.accountNumber}</td>
                          <td className="px-3 py-2 text-zinc-300 text-xs">{l.account?.name}{l.description ? ` — ${l.description}` : ''}</td>
                          <td className="px-3 py-2 text-end font-mono text-xs text-zinc-300">{l.debit > 0 ? fmt(l.debit) : ''}</td>
                          <td className="px-5 py-2 text-end font-mono text-xs text-zinc-300">{l.credit > 0 ? fmt(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
