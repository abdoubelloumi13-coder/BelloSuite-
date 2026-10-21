'use client'

/**
 * Section « Facture électronique (El Fatoora) » de la fiche facture — MODE SIMULATION.
 * Étapes : TEIF → Signé → Déposé → Validé + QR. Signature par clé de test locale ou
 * DigiGo simulé (OTP 6 chiffres), dépôt au simulateur TTN. Non valable fiscalement.
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, CheckCircle, Download, FileCode, KeyRound, Loader2, PenLine, Send, ShieldCheck, X, XCircle } from 'lucide-react'

type Step = 'teif' | 'signed' | 'submitted' | 'validated' | 'rejected'

interface EInvoiceStatus {
  step: Step
  tableMissing: boolean
  tableMissingMessage: string | null
  mode: string | null
  signedAt: string | null
  referenceTTN: string | null
  qrDataUrl: string | null
  submittedAt: string | null
  acceptedAt: string | null
  errorMessage: string | null
}

const STEPS: Step[] = ['teif', 'signed', 'submitted', 'validated']

function stepIndex(s: Step): number {
  if (s === 'validated') return 3
  if (s === 'rejected') return 2
  if (s === 'signed') return 1
  return 0
}

export function EInvoicePanel({ invoiceId, onChanged }: { invoiceId: string; onChanged?: () => void }) {
  const t = useTranslations('EInvoice')
  const [status, setStatus] = useState<EInvoiceStatus | null>(null)
  const [busy, setBusy] = useState<null | 'sign' | 'submit'>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorList, setErrorList] = useState<string[]>([])
  const [otpOpen, setOtpOpen] = useState(false)
  const [otp, setOtp] = useState('')
  const [defaultMode, setDefaultMode] = useState<'local' | 'digigo-mock'>('local')

  const base = `/api/commercial/invoices/${invoiceId}/einvoice`

  const load = useCallback(async () => {
    try {
      const res = await fetch(base)
      if (res.ok) setStatus(await res.json())
    } catch { /* hors ligne : section masquée */ }
  }, [base])

  useEffect(() => {
    load()
    fetch('/api/commercial/einvoice/settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.settings?.mode === 'digigo-mock') setDefaultMode('digigo-mock') })
      .catch(() => undefined)
  }, [load])

  const showError = (data: { error?: string; errors?: string[] } | null, fallback: string) => {
    setError(data?.error || fallback)
    setErrorList(Array.isArray(data?.errors) ? data!.errors! : [])
  }

  const sign = async (mode: 'local' | 'digigo-mock', code?: string) => {
    setBusy('sign'); setError(null); setErrorList([])
    try {
      const res = await fetch(`${base}/sign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ...(code ? { otp: code } : {}) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { showError(data, t('sign_failed')); return }
      setOtpOpen(false); setOtp('')
      await load(); onChanged?.()
    } catch { setError(t('network_error')) } finally { setBusy(null) }
  }

  const submit = async () => {
    setBusy('submit'); setError(null); setErrorList([])
    try {
      const res = await fetch(`${base}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json().catch(() => null)
      if (!res.ok) showError(data, t('submit_failed'))
      await load(); onChanged?.()
    } catch { setError(t('network_error')) } finally { setBusy(null) }
  }

  const download = async (variant: '' | 'signed' | 'validated') => {
    setError(null); setErrorList([])
    try {
      const res = await fetch(`${base}/xml${variant ? `?${variant}=1` : ''}`)
      if (!res.ok) { showError(await res.json().catch(() => null), t('download_failed')); return }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'TEIF.xml'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url; a.download = name; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setError(t('network_error')) }
  }

  if (!status) return null
  const idx = stepIndex(status.step)
  const signed = idx >= 1
  const validated = status.step === 'validated'
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-TN', { timeZone: 'Africa/Tunis' }) : '')

  return (
    <section className="rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-6 space-y-5 text-start" aria-labelledby="einvoice-title">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-7 h-7 text-teal-600 dark:text-teal-400" />
          <div>
            <h2 id="einvoice-title" className="font-black text-stone-900 dark:text-white text-lg">{t('title')}</h2>
            <p className="text-xs text-stone-500 dark:text-zinc-400 font-medium">{t('subtitle')}</p>
          </div>
        </div>
      </div>

      <div role="note" className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 dark:bg-orange-500/10 dark:border-orange-500/30 px-4 py-3">
        <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-black text-orange-800 dark:text-orange-300">{t('simulation_banner')}</p>
          <p className="text-xs text-orange-700 dark:text-orange-400/90 mt-0.5">{t('simulation_banner_detail')}</p>
        </div>
      </div>

      {status.tableMissing && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-4 py-3 text-sm font-bold text-red-700 dark:text-red-400">
          {status.tableMissingMessage || t('table_missing')}
        </div>
      )}

      {/* Étapes */}
      <ol className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {STEPS.map((s, i) => {
          const done = i <= idx && !(status.step === 'rejected' && i === 2)
          const rejected = status.step === 'rejected' && i === 2
          return (
            <li key={s} className={`rounded-xl border px-3 py-2 text-xs font-bold flex items-center gap-2 ${
              rejected ? 'border-red-200 bg-red-50 text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400'
                : done ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
                  : 'border-stone-200 bg-stone-50 text-stone-500 dark:bg-zinc-950/50 dark:border-zinc-800 dark:text-zinc-500'}`}>
              {rejected ? <XCircle className="w-4 h-4" /> : done ? <CheckCircle className="w-4 h-4" /> : <span className="w-4 h-4 rounded-full border border-current inline-block" />}
              <span>{i + 1}. {t(rejected ? 'step_rejected' : `step_${s}`)}</span>
            </li>
          )
        })}
      </ol>

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => download('')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 font-bold text-sm">
          <FileCode className="w-4 h-4" /> {t('download_teif')}
        </button>
        {!validated && (
          <>
            <button type="button" disabled={!!busy || status.tableMissing} onClick={() => sign('local')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-50 ${defaultMode === 'local' ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'border border-purple-200 text-purple-700 dark:border-purple-500/30 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/10'}`}>
              {busy === 'sign' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PenLine className="w-4 h-4" />} {t('sign_local')}
            </button>
            <button type="button" disabled={!!busy || status.tableMissing} onClick={() => { setOtp(''); setOtpOpen(true) }}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-50 ${defaultMode === 'digigo-mock' ? 'bg-purple-600 hover:bg-purple-500 text-white' : 'border border-purple-200 text-purple-700 dark:border-purple-500/30 dark:text-purple-300 hover:bg-purple-50 dark:hover:bg-purple-500/10'}`}>
              <KeyRound className="w-4 h-4" /> {t('sign_digigo')}
            </button>
          </>
        )}
        {signed && (
          <button type="button" onClick={() => download('signed')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 font-bold text-sm">
            <Download className="w-4 h-4" /> {t('download_signed')}
          </button>
        )}
        {signed && !validated && (
          <button type="button" disabled={!!busy || status.tableMissing} onClick={submit}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-black text-sm disabled:opacity-50">
            {busy === 'submit' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {t('submit_ttn')}
          </button>
        )}
        {validated && (
          <button type="button" onClick={() => download('validated')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 font-bold text-sm">
            <Download className="w-4 h-4" /> {t('download_validated')}
          </button>
        )}
      </div>

      {signed && (
        <p className="text-xs text-stone-500 dark:text-zinc-400">
          {t('signed_info', { date: fmtDate(status.signedAt), mode: status.mode === 'digigo-mock' ? t('mode_digigo') : t('mode_local') })}
        </p>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          <p className="font-bold">{error}</p>
          {errorList.length > 0 && <ul className="list-disc ms-5 mt-1 text-xs space-y-0.5">{errorList.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
      {status.step === 'rejected' && status.errorMessage && !error && (
        <p className="text-xs font-bold text-red-600 dark:text-red-400">⚠ {status.errorMessage}</p>
      )}

      {validated && (
        <div className="flex items-center gap-5 flex-wrap rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-500/5 p-4">
          {status.qrDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={status.qrDataUrl} alt={t('qr_alt')} className="w-28 h-28 rounded-lg border border-stone-200 bg-white" />
          )}
          <div className="space-y-1">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{t('reference_ttn')}</p>
            <p className="font-mono font-black text-stone-900 dark:text-white break-all">{status.referenceTTN}</p>
            <p className="text-xs text-stone-500 dark:text-zinc-400">{t('validated_at', { date: fmtDate(status.acceptedAt) })}</p>
            <p className="text-[11px] font-bold text-orange-700 dark:text-orange-400">{t('simulation_banner')}</p>
          </div>
        </div>
      )}

      {otpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="otp-title">
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 id="otp-title" className="font-black text-stone-900 dark:text-white">{t('otp_title')}</h3>
              <button type="button" onClick={() => setOtpOpen(false)} aria-label={t('cancel')} className="p-1 rounded-lg hover:bg-stone-100 dark:hover:bg-zinc-800">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-stone-500 dark:text-zinc-400">{t('otp_help')}</p>
            <form onSubmit={e => { e.preventDefault(); if (/^\d{6}$/.test(otp)) sign('digigo-mock', otp) }} className="space-y-4">
              <input
                autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
                value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                aria-label={t('otp_label')} placeholder="••••••"
                className="w-full text-center tracking-[0.6em] font-mono text-2xl rounded-xl border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 px-4 py-3"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setOtpOpen(false)} className="px-4 py-2 rounded-xl border border-stone-200 dark:border-zinc-700 text-sm font-bold">{t('cancel')}</button>
                <button type="submit" disabled={otp.length !== 6 || busy === 'sign'}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-black disabled:opacity-50">
                  {busy === 'sign' && <Loader2 className="w-4 h-4 animate-spin" />} {t('otp_confirm')}
                </button>
              </div>
            </form>
            <p className="text-[11px] font-bold text-orange-700 dark:text-orange-400">{t('otp_simulation_note')}</p>
          </div>
        </div>
      )}
    </section>
  )
}
