'use client'

/**
 * Points à vérifier : anomalies détectées chaque nuit (/api/cron/anomalies) pour le tenant de la session.
 * Filtres Ouvertes / Ignorées / Résolues, lien vers le document, boutons Ignorer / Résolu / Rouvrir,
 * analyse immédiate (administrateurs) et désinscription de l'email matinal.
 */
import React, { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CheckCircle2, EyeOff, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { documentPath } from '@/lib/anomalies'
import { StockPage, PageHeader, Card, Alert, Badge, EmptyState, Loading, api, cls, intlLocale } from '@/components/stock/ui'
import { SEVERITY_TONE, useAnomalyText, type AnomalyList } from '@/components/anomalies/shared'

type Status = 'OPEN' | 'IGNORED' | 'RESOLVED'
const STATUSES: Status[] = ['OPEN', 'IGNORED', 'RESOLVED']

export default function AnomaliesPage() {
  const t = useTranslations('Anomalies')
  const locale = useLocale()
  const text = useAnomalyText()
  const [status, setStatus] = useState<Status>('OPEN')
  const [data, setData] = useState<AnomalyList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [prefs, setPrefs] = useState<{ emailOptOut: boolean; isAdmin: boolean } | null>(null)

  const fmtDate = (d: string) => new Date(d).toLocaleString(intlLocale(locale), { dateStyle: 'medium', timeStyle: 'short' })
  const fmtAmount = (n: number) => new Intl.NumberFormat(intlLocale(locale), { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n)

  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey(k => k + 1)

  useEffect(() => {
    let alive = true
    api<AnomalyList>(`/api/anomalies?status=${status}`).then(r => {
      if (!alive) return
      setLoading(false)
      if (!r.ok) { setError(r.error || t('error')); return }
      setError(null)
      setData(r.data)
    })
    return () => { alive = false }
  }, [status, reloadKey, t])
  useEffect(() => {
    api<{ emailOptOut: boolean; isAdmin: boolean }>('/api/anomalies/preferences').then(r => { if (r.ok) setPrefs(r.data) })
  }, [])

  const setAnomalyStatus = async (id: string, next: Status) => {
    setBusy(id)
    const r = await api(`/api/anomalies/${id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) })
    setBusy(null)
    if (!r.ok) { setError(r.error || t('error')); return }
    reload()
  }

  const runNow = async () => {
    setBusy('run')
    const r = await api<{ open: number }>('/api/anomalies/run', { method: 'POST' })
    setBusy(null)
    if (!r.ok) { setError(r.error || t('error')); return }
    setNotice(t('run_done', { count: r.data.open }))
    reload()
  }

  const toggleOptOut = async () => {
    if (!prefs) return
    const r = await api<{ emailOptOut: boolean }>('/api/anomalies/preferences', { method: 'PUT', body: JSON.stringify({ emailOptOut: !prefs.emailOptOut }) })
    if (r.ok) { setPrefs({ ...prefs, emailOptOut: r.data.emailOptOut }); setNotice(t('email_optout_saved')) }
  }

  return (
    <StockPage>
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={prefs?.isAdmin && !data?.tableMissing ? (
          <button type="button" className={cls.btnPrimary} onClick={runNow} disabled={busy === 'run'}>
            <RefreshCw className={`w-4 h-4 ${busy === 'run' ? 'animate-spin' : ''}`} /> {busy === 'run' ? t('running') : t('run_now')}
          </button>
        ) : undefined}
      />

      {error && <div className="mb-4"><Alert onClose={() => setError(null)}>{error}</Alert></div>}
      {notice && <div className="mb-4"><Alert tone="green" onClose={() => setNotice(null)}>{notice}</Alert></div>}
      {data?.tableMissing && <div className="mb-4"><Alert tone="amber">{t('table_missing')}</Alert></div>}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="inline-flex bg-zinc-100 rounded-xl p-1">
          {STATUSES.map(s => (
            <button key={s} type="button" onClick={() => { if (s !== status) { setLoading(true); setStatus(s) } }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${status === s ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
              {t(`filters.${s}`)} <span className="text-xs text-zinc-400 tabular-nums">{data?.counts?.[s] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <span>{data?.lastRun ? t('last_run', { date: fmtDate(data.lastRun.startedAt) }) : t('never_run')}</span>
          {prefs && (
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={prefs.emailOptOut} onChange={toggleOptOut} className="accent-teal-600" />
              {t('email_optout')}
            </label>
          )}
        </div>
      </div>

      <Card bodyClassName="p-0">
        {loading ? <Loading /> : !data || data.items.length === 0 ? <EmptyState title={t('empty')} /> : (
          <ul className="divide-y divide-zinc-100">
            {data.items.map(a => {
              const { title, detail } = text(a)
              return (
                <li key={a.id} className="p-4 flex flex-col md:flex-row md:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge tone={SEVERITY_TONE[a.severity]}>{t(`severity.${a.severity as 'HIGH'}`)}</Badge>
                      <span className="font-semibold text-zinc-900">{title}</span>
                      <span className="text-xs text-zinc-400 tabular-nums">{a.score}</span>
                    </div>
                    <p className="text-sm text-zinc-600 break-words">{detail}</p>
                    <p className="text-xs text-zinc-400 mt-1">
                      {t('detected_on', { date: fmtDate(a.firstSeenAt) })}
                      {a.amount != null && <> · {t('amount')} : <span className="tabular-nums">{fmtAmount(a.amount)} TND</span></>}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Link href={documentPath(a.documentKind, a.documentId)} className={cls.btnSecondary}>
                      <ExternalLink className="w-4 h-4" /> {t('open_document')}
                    </Link>
                    {a.status === 'OPEN' ? (
                      <>
                        <button type="button" className={cls.btnGhost} disabled={busy === a.id} onClick={() => setAnomalyStatus(a.id, 'IGNORED')}>
                          <EyeOff className="w-4 h-4" /> {t('ignore')}
                        </button>
                        <button type="button" className={cls.btnGhost} disabled={busy === a.id} onClick={() => setAnomalyStatus(a.id, 'RESOLVED')}>
                          <CheckCircle2 className="w-4 h-4" /> {t('resolve')}
                        </button>
                      </>
                    ) : (
                      <button type="button" className={cls.btnGhost} disabled={busy === a.id} onClick={() => setAnomalyStatus(a.id, 'OPEN')}>
                        <RotateCcw className="w-4 h-4" /> {t('reopen')}
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <p className="text-xs text-zinc-400 mt-3">{t('help')}</p>
    </StockPage>
  )
}
