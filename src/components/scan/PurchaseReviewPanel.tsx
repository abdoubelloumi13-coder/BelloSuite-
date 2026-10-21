'use client'

/**
 * Contrôle avant saisie d'une facture d'achat scannée : doublons, matricule, cohérence des montants,
 * retenue à la source au paiement et écritures proposées. Appelle /api/scan/purchase-review (rien n'est enregistré).
 */
import React, { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, AlertTriangle, XCircle, Loader2, RotateCcw } from 'lucide-react'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { sanitizeExtractionForReview } from '@/lib/purchase-review-input'
import { apiErrorMessage } from '@/lib/zod-helpers'
import { Card, cls, useStockFormat } from '@/components/stock/ui'
import type { InvoiceExtraction } from '@/lib/invoice-extract'
import type { PurchaseReview } from '@/lib/purchase-review'

const statusUi = {
  READY: { icon: CheckCircle2, cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  TO_CHECK: { icon: AlertTriangle, cls: 'text-amber-800 bg-amber-50 border-amber-200' },
  BLOCKED: { icon: XCircle, cls: 'text-red-700 bg-red-50 border-red-200' },
} as const

const REVIEW_TIMEOUT_MS = 20_000

export function PurchaseReviewPanel({ extraction, onReview }: { extraction: InvoiceExtraction; onReview?: (r: PurchaseReview | null) => void }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  // Un seul état par extraction : chargement → contrôle affiché ou erreur visible (jamais de spinner sans fin)
  const [state, setState] = useState<{ for: InvoiceExtraction | null; review: PurchaseReview | null; error: string }>({ for: null, review: null, error: '' })
  const [attempt, setAttempt] = useState(0)
  const onReviewRef = useRef(onReview)
  const tRef = useRef(t)
  useEffect(() => { onReviewRef.current = onReview; tRef.current = t }, [onReview, t])

  useEffect(() => {
    let alive = true
    fetchWithTimeout('/api/scan/purchase-review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extraction: sanitizeExtractionForReview(extraction) }),
    }, REVIEW_TIMEOUT_MS)
      .then(async (r) => {
        const j = await r.json().catch(() => null)
        if (!alive) return
        const review: PurchaseReview | null = r.ok && j?.review ? j.review : null
        setState({ for: extraction, review, error: review ? '' : apiErrorMessage(j, `${tRef.current('review_error')} (HTTP ${r.status})`) })
        onReviewRef.current?.(review)
      })
      .catch((e: unknown) => {
        if (!alive) return
        const timeout = (e as Error)?.name === 'AbortError'
        setState({ for: extraction, review: null, error: timeout ? tRef.current('review_timeout') : tRef.current('review_error') })
        onReviewRef.current?.(null)
      })
    return () => { alive = false }
  }, [extraction, attempt])

  const loading = state.for !== extraction
  const review = loading ? null : state.review
  if (loading) {
    return (
      <Card title={t('review_title')}>
        <div className="flex items-center gap-2 text-sm text-zinc-600" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" /> {t('review_loading')}
        </div>
      </Card>
    )
  }
  if (!review) {
    return (
      <Card title={t('review_title')}>
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-red-700">
          <XCircle className="w-4 h-4" /> <span className="flex-1">{state.error}</span>
          <button type="button" className={cls.btnSecondary} onClick={() => { setState(s => ({ ...s, for: null })); setAttempt(a => a + 1) }}>
            <RotateCcw className="w-4 h-4" /> {t('review_retry')}
          </button>
        </div>
      </Card>
    )
  }
  const S = statusUi[review.status] ?? statusUi.TO_CHECK
  const renderEntry = (lines: PurchaseReview['entry']['lines']) => (
    <table className={cls.table + ' mt-2'}>
      <thead><tr><th className={cls.th}>{t('account')}</th><th className={cls.th + ' text-end'}>{t('debit')}</th><th className={cls.th + ' text-end'}>{t('credit')}</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">
        {lines.map((l, i) => (
          <tr key={i}><td className={cls.td}><span className="font-mono me-2">{l.account}</span><span className="text-xs text-zinc-500">{l.label}</span></td>
            <td className={cls.tdNum}>{l.debit ? f.money(l.debit) : ''}</td><td className={cls.tdNum}>{l.credit ? f.money(l.credit) : ''}</td></tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <Card title={t('review_title')}>
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-semibold ${S.cls}`}><S.icon className="w-4 h-4" /> {t(`review_${review.status}`)}</div>
      {(review.issues?.length ?? 0) > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-start">
          {review.issues.map((is, i) => (
            <li key={i} className={is.level === 'blocking' ? 'text-red-700' : is.level === 'warning' ? 'text-amber-800' : 'text-zinc-600'}>
              • {t(`issue_${is.code}` as 'issue_NO_REF', { ref: is.ref ?? '' })}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 text-sm text-start">
        <div className="text-xs text-zinc-500">{t('review_rs')}</div>
        {review.rs.applies
          ? <div><b>{f.money(review.rs.amount)}</b> <span className="text-zinc-500">({review.rs.label}{review.rs.tejCode ? ` · ${review.rs.tejCode}` : ''})</span> · {t('review_net')} <b>{f.money(review.rs.netToPay)}</b></div>
          : <div className="text-zinc-600">{t('review_rs_none')}</div>}
      </div>
      <details className="mt-4 text-start">
        <summary className="cursor-pointer text-sm font-semibold text-zinc-700">{t('review_entry')}</summary>
        {renderEntry(review.entry.lines)}
        <div className="mt-3 text-sm font-semibold text-zinc-700">{t('review_payment')}</div>
        {renderEntry(review.payment.lines)}
      </details>
    </Card>
  )
}
