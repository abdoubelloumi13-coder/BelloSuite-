'use client'

/**
 * Assistant fiscal tunisien : chat RAG (/api/ai/fiscal-assistant) avec citations cliquables
 * + onglet « Recherche dans les textes » (/api/fiscal/search). Authentification / tenant : layout (dashboard).
 * Rien n'est stocké côté client au-delà de l'état de la page.
 */
import React, { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BookOpen, ExternalLink, Search, Send, Sparkles, Trash2, X } from 'lucide-react'
import { StockPage, PageHeader, Card, Alert, Badge, cls } from '@/components/stock/ui'
import { SUGGESTED_QUESTION_KEYS, shortCitation, splitAnswer } from '@/lib/fiscal-search-utils'

type Citation = {
  n?: number
  label: string
  code: string
  article: string | null
  version: string
  lang: string
  url: string
  outdated: boolean
  excerpt?: string
}
type AssistantReply = { answer: string; status: 'ok' | 'no_sources' | 'retrieval_only'; lang: string; citations: Citation[] }
type Turn = { q: string; r?: AssistantReply; error?: string }
type SearchResult = { id: string; score: number; matchedBy: string[]; snippet: string; content: string; citation: Citation }

const CODES = ['TVA', 'DET', 'IRPP_IS', 'LF2026', 'FODEC'] as const

function dirOf(lang: string): 'rtl' | 'ltr' {
  return lang === 'ar' ? 'rtl' : 'ltr'
}

function ExcerptDrawer({ c, onClose }: { c: Citation & { text: string }; onClose: () => void }) {
  const t = useTranslations('FiscalAssistant')
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={c.label}>
      <button type="button" className="absolute inset-0 bg-black/30" aria-label={t('close')} onClick={onClose} />
      <aside className="relative h-full w-full max-w-xl bg-white shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-zinc-200">
          <div className="text-start">
            <p className="text-xs uppercase tracking-wide text-zinc-500">{t('excerpt')}</p>
            <h2 className="font-bold text-zinc-900">{c.label}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="blue">{t('code')} : {c.code}</Badge>
              {c.article && <Badge tone="zinc">{t('article')} {c.article}</Badge>}
              <Badge tone="zinc">{t('version')} {c.version}</Badge>
              {c.lang === 'ar' && <Badge tone="teal">{t('arabic_text')}</Badge>}
              {c.outdated && <Badge tone="amber">{t('outdated')}</Badge>}
            </div>
          </div>
          <button type="button" onClick={onClose} className={cls.btnGhost} aria-label={t('close')}><X className="w-4 h-4" /></button>
        </div>
        {c.outdated && <div className="mx-5 mt-4"><Alert tone="amber">{t('outdated_hint')}</Alert></div>}
        <div className="flex-1 overflow-y-auto p-5">
          <p dir={dirOf(c.lang)} className="whitespace-pre-wrap text-sm leading-7 text-zinc-800 text-start">{c.text}</p>
        </div>
        <div className="p-5 border-t border-zinc-200">
          <a href={c.url} target="_blank" rel="noopener noreferrer" className={cls.btnSecondary}>
            <ExternalLink className="w-4 h-4" /> {t('open_source')}
          </a>
        </div>
      </aside>
    </div>
  )
}

function AnswerText({ reply, onCite }: { reply: AssistantReply; onCite: (c: Citation) => void }) {
  const byN = new Map(reply.citations.map((c) => [c.n, c]))
  return (
    <div dir={dirOf(reply.lang)} className="whitespace-pre-wrap text-sm leading-7 text-zinc-800 text-start">
      {splitAnswer(reply.answer).map((s, i) => {
        if (s.type === 'text') return <React.Fragment key={i}>{s.text}</React.Fragment>
        const c = byN.get(s.n)
        if (!c) return null
        return (
          <button key={i} type="button" onClick={() => onCite(c)} title={c.label}
            className={`mx-0.5 inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold align-baseline ${c.outdated ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-teal-50 text-teal-700 hover:bg-teal-100'}`}>
            {s.n}
          </button>
        )
      })}
    </div>
  )
}

function AssistantTab({ onOpen }: { onOpen: (c: Citation & { text: string }) => void }) {
  const t = useTranslations('FiscalAssistant')
  const locale = useLocale()
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)

  async function ask(q: string) {
    const text = q.trim()
    if (text.length < 3 || busy) return
    setBusy(true)
    setQuestion('')
    setTurns((prev) => [...prev, { q: text }])
    let turn: Turn = { q: text }
    try {
      const res = await fetch('/api/ai/fiscal-assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: text }) })
      if (res.status === 429) turn = { q: text, error: t('rate_limited') }
      else if (!res.ok) turn = { q: text, error: t('error') }
      else turn = { q: text, r: (await res.json()) as AssistantReply }
    } catch {
      turn = { q: text, error: t('error') }
    }
    setTurns((prev) => [...prev.slice(0, -1), turn])
    setBusy(false)
  }

  const open = (c: Citation) => onOpen({ ...c, text: c.excerpt ?? '' })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <Card bodyClassName="p-0">
          <div className="max-h-[60vh] min-h-[280px] overflow-y-auto p-5 space-y-5">
            {turns.length === 0 && <p className="text-sm text-zinc-500 text-start">{t('empty_chat')}</p>}
            {turns.map((turn, i) => (
              <div key={i} className="space-y-3">
                <div className="flex justify-end">
                  <div dir="auto" className="max-w-[85%] rounded-2xl bg-teal-600 text-white px-4 py-2.5 text-sm text-start">{turn.q}</div>
                </div>
                {!turn.r && !turn.error && <p className="text-sm text-zinc-500 animate-pulse text-start">{t('thinking')}</p>}
                {turn.error && <Alert>{turn.error}</Alert>}
                {turn.r && (
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 space-y-3">
                    {turn.r.status === 'retrieval_only' && <Alert tone="amber">{t('retrieval_only')}</Alert>}
                    <AnswerText reply={turn.r} onCite={open} />
                    {turn.r.citations.length > 0 && (
                      <div className="pt-2 border-t border-zinc-200">
                        <p className="text-xs font-semibold text-zinc-500 mb-2 text-start">{t('sources')}</p>
                        <div className="flex flex-wrap gap-2">
                          {turn.r.citations.map((c) => (
                            <button key={`${c.n}-${c.label}`} type="button" onClick={() => open(c)} title={c.label}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${c.outdated ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-zinc-300 bg-white text-zinc-700 hover:border-teal-500'}`}>
                              <BookOpen className="w-3 h-3" />
                              {c.n ? `[${c.n}] ` : ''}{shortCitation(c, locale)}
                              {c.outdated && <span>· {t('outdated')}</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <form className="flex gap-2 border-t border-zinc-200 p-4" onSubmit={(e) => { e.preventDefault(); void ask(question) }}>
            <input dir="auto" className={cls.input} value={question} maxLength={1500} onChange={(e) => setQuestion(e.target.value)} placeholder={t('placeholder')} aria-label={t('placeholder')} />
            <button type="submit" className={cls.btnPrimary} disabled={busy || question.trim().length < 3}>
              <Send className="w-4 h-4 rtl:-scale-x-100" /> {t('ask')}
            </button>
            {turns.length > 0 && (
              <button type="button" className={cls.btnGhost} onClick={() => setTurns([])} disabled={busy} title={t('new_chat')} aria-label={t('new_chat')}><Trash2 className="w-4 h-4" /></button>
            )}
          </form>
        </Card>
        <p className="text-xs text-zinc-500 text-start">{t('privacy')}</p>
      </div>
      <Card title={t('suggested')}>
        <div className="flex flex-col gap-2">
          {SUGGESTED_QUESTION_KEYS.map((k) => (
            <button key={k} type="button" disabled={busy} onClick={() => void ask(t(k))}
              className="text-start rounded-xl border border-zinc-200 px-3 py-2.5 text-sm text-zinc-700 hover:border-teal-500 hover:bg-teal-50/40 disabled:opacity-50">
              <Sparkles className="inline w-3.5 h-3.5 me-1.5 text-teal-600" />{t(k)}
            </button>
          ))}
        </div>
      </Card>
    </div>
  )
}

function SearchTab({ onOpen }: { onOpen: (c: Citation & { text: string }) => void }) {
  const t = useTranslations('FiscalAssistant')
  const [q, setQ] = useState('')
  const [code, setCode] = useState<string>('')
  const [currentOnly, setCurrentOnly] = useState(true)
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(e?: React.FormEvent) {
    e?.preventDefault()
    if (q.trim().length < 2 || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/fiscal/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: q.trim(), currentOnly, limit: 20, ...(code ? { codes: [code] } : {}) }),
      })
      if (res.status === 429) { setError(t('rate_limited')); setResults(null) }
      else if (!res.ok) { setError(t('error')); setResults(null) }
      else setResults(((await res.json()) as { results: SearchResult[] }).results)
    } catch {
      setError(t('error'))
    }
    setBusy(false)
  }

  return (
    <div className="space-y-4">
      <Card>
        <form onSubmit={run} className="flex flex-col md:flex-row gap-3 md:items-center">
          <input dir="auto" className={cls.input} value={q} maxLength={500} onChange={(e) => setQ(e.target.value)} placeholder={t('search_placeholder')} aria-label={t('search_placeholder')} />
          <select className={`${cls.input} md:w-64`} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t('code')}>
            <option value="">{t('all_codes')}</option>
            {CODES.map((c) => <option key={c} value={c}>{t(`code_${c}`)}</option>)}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700 whitespace-nowrap">
            <input type="checkbox" checked={currentOnly} onChange={(e) => setCurrentOnly(e.target.checked)} className="accent-teal-600" />
            {t('current_only')}
          </label>
          <button type="submit" className={cls.btnPrimary} disabled={busy || q.trim().length < 2}><Search className="w-4 h-4" /> {busy ? t('searching') : t('search')}</button>
        </form>
      </Card>
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {results && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 text-start">{t('results_count', { count: results.length })}</p>
          {results.length === 0 && <Card><p className="text-sm text-zinc-500 text-start">{t('no_results')}</p></Card>}
          {results.map((r) => (
            <button key={r.id} type="button" onClick={() => onOpen({ ...r.citation, text: r.content })}
              className={`${cls.card} block w-full p-4 text-start hover:border-teal-500 transition-colors`}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-semibold text-sm text-zinc-900">{r.citation.label}</span>
                {r.citation.outdated && <Badge tone="amber">{t('outdated')}</Badge>}
                {r.matchedBy.map((m) => <Badge key={m} tone="zinc">{m === 'vector' ? t('match_vector') : t('match_fulltext')}</Badge>)}
              </div>
              <p dir={dirOf(r.citation.lang)} className="text-sm text-zinc-600 leading-6 text-start">{r.snippet}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FiscalAssistantPage() {
  const t = useTranslations('FiscalAssistant')
  const [tab, setTab] = useState<'assistant' | 'search'>('assistant')
  const [drawer, setDrawer] = useState<(Citation & { text: string }) | null>(null)

  const tabBtn = (k: 'assistant' | 'search', label: string) => (
    <button type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
      className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${tab === k ? 'bg-teal-600 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>
      {label}
    </button>
  )

  return (
    <StockPage>
      <PageHeader title={t('title')} description={t('desc')} />
      <div role="tablist" className="mb-5 inline-flex gap-1 rounded-2xl border border-zinc-200 bg-white p-1">
        {tabBtn('assistant', t('tab_assistant'))}
        {tabBtn('search', t('tab_search'))}
      </div>
      {tab === 'assistant' ? <AssistantTab onOpen={setDrawer} /> : <SearchTab onOpen={setDrawer} />}
      {drawer && <ExcerptDrawer c={drawer} onClose={() => setDrawer(null)} />}
    </StockPage>
  )
}
