'use client'

/**
 * « Zéro saisie » : import d'une pièce fournisseur (facture, bon de commande, devis, BL) depuis un PDF, une image
 * ou directement l'appareil photo (téléphone : caméra arrière via `capture` ; ordinateur : webcam si disponible).
 * 1. Texte extrait dans le navigateur (pdfjs / Tesseract) — fonctionne sans clé API.
 * 2. Parseur déterministe (src/lib/invoice-extract.ts), type de pièce détecté.
 * 3. Affinage IA optionnel (/api/ai/extract-invoice) fusionné SANS jamais l'emporter sur l'arithmétique.
 * Le fichier n'est ni envoyé au serveur de BelloSuite (sauf l'image vers l'IA si une clé est configurée) ni stocké.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import { FileUp, Loader2, CheckCircle2, AlertTriangle, Sparkles, Camera, ScanLine, X } from 'lucide-react'
import { useStockFormat, cls } from '@/components/stock/ui'
import { extractInvoice, mergeAiExtraction, LOW_CONFIDENCE, type InvoiceExtraction, type AiInvoice } from '@/lib/invoice-extract'
import type { OcrProgress } from '@/lib/invoice-ocr-client'

const MAX_BYTES = 5 * 1024 * 1024
const SAMPLES = [
  { file: 'facture-fournisseur-demo.pdf', type: 'application/pdf', label: 'ocr_try_sample_pdf' },
  { file: 'facture-fournisseur-demo.png', type: 'image/png', label: 'ocr_try_sample_photo' },
] as const

type Status = { kind: 'idle' } | { kind: 'busy'; p: OcrProgress | null; ai?: boolean } | { kind: 'error'; key: string } | { kind: 'done'; x: InvoiceExtraction; ai: boolean }
/** capture = téléphone / tablette (input capture) ; webcam = ordinateur avec caméra (getUserMedia) ; none = pas de caméra */
type CameraMode = 'capture' | 'webcam' | 'none' | null

export type ImportVariant = 'invoice' | 'order' | 'scan'
const TITLE: Record<ImportVariant, string> = { invoice: 'import_invoice', order: 'import_order', scan: 'scan_panel_title' }

function detectCameraMode(): CameraMode {
  if (typeof window === 'undefined') return null
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  if (coarse) return 'capture'
  if (typeof navigator !== 'undefined' && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') return 'webcam'
  return 'none'
}

export function InvoiceImportPanel({ onExtracted, variant = 'invoice', showSamples = true }: { onExtracted: (x: InvoiceExtraction) => void; variant?: ImportVariant; showSamples?: boolean }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const fileInput = useRef<HTMLInputElement>(null)
  const cameraInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [drag, setDrag] = useState(false)
  const [camMode, setCamMode] = useState<CameraMode>(null)
  const [webcamOpen, setWebcamOpen] = useState(false)

  useEffect(() => { setCamMode(detectCameraMode()) }, [])

  async function handle(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_BYTES) { setStatus({ kind: 'error', key: 'ocr_too_large' }); return }
    if (!(file.type === 'application/pdf' || file.type.startsWith('image/') || /\.pdf$/i.test(file.name))) { setStatus({ kind: 'error', key: 'ocr_unsupported' }); return }
    setStatus({ kind: 'busy', p: null })
    try {
      const { extractInvoiceText, imageDataUrlForAi } = await import('@/lib/invoice-ocr-client')
      const { text, image: pdfImage } = await extractInvoiceText(file, (p) => setStatus({ kind: 'busy', p }))
      let x = extractInvoice(text)
      let aiUsed = false
      // Affinage IA : silencieux si aucune clé n'est configurée ou en cas d'erreur
      try {
        setStatus({ kind: 'busy', p: { stage: 'done', progress: 1 }, ai: true })
        const image = pdfImage ?? (await imageDataUrlForAi(file))
        const res = await fetch('/api/ai/extract-invoice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 30_000), image }) })
        if (res.ok) {
          const body = (await res.json()) as { available?: boolean; result?: AiInvoice | null }
          if (body.available && body.result) { x = mergeAiExtraction(x, body.result); aiUsed = true }
        }
      } catch { /* IA facultative */ }
      if (!text.trim() && !aiUsed) { setStatus({ kind: 'error', key: 'ocr_no_text' }); return }
      setStatus({ kind: 'done', x, ai: aiUsed })
      onExtracted(x)
    } catch (e) {
      setStatus({ kind: 'error', key: (e as Error)?.message === 'too_large' ? 'ocr_too_large' : 'ocr_failed' })
    } finally {
      if (fileInput.current) fileInput.current.value = ''
      if (cameraInput.current) cameraInput.current.value = ''
    }
  }

  /** Démo : facture fictive servie depuis public/samples, traitée exactement comme un fichier déposé. */
  async function trySample(name: string, type: string) {
    try {
      const res = await fetch(`/samples/${name}`)
      if (!res.ok) throw new Error('sample')
      await handle(new File([await res.blob()], name, { type }))
    } catch {
      setStatus({ kind: 'error', key: 'ocr_failed' })
    }
  }

  const busy = status.kind === 'busy'
  const stageLabel = (p: OcrProgress | null, ai?: boolean) => {
    if (ai) return t('ocr_stage_ai')
    if (!p) return t('ocr_stage_start')
    const page = p.pages && p.pages > 1 ? ` (${t('ocr_page', { page: p.page ?? 1, pages: p.pages })})` : ''
    return t(`ocr_stage_${p.stage}` as 'ocr_stage_pdf') + page
  }
  const openCamera = () => {
    if (busy) return
    if (camMode === 'webcam') setWebcamOpen(true)
    else cameraInput.current?.click()
  }
  const kind = status.kind === 'done' ? status.x.documentType?.value ?? null : null

  return (
    <section
      className={`mb-5 rounded-2xl border-2 p-4 transition-colors ${drag ? 'border-teal-500 bg-teal-50' : 'border-teal-200 bg-gradient-to-br from-teal-50 to-white'}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (!busy) handle(e.dataTransfer.files?.[0]) }}
      aria-busy={busy}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-xl bg-teal-600 p-2.5 text-white shadow-sm">
          {busy ? <Loader2 className="w-6 h-6 animate-spin" /> : <ScanLine className="w-6 h-6" />}
        </div>
        <div className="min-w-0 flex-1 text-start">
          <h3 className="font-semibold text-zinc-900">{t(TITLE[variant] as 'import_invoice')}</h3>
          <p className="mt-0.5 text-xs text-zinc-600">{t('import_invoice_hint')}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {camMode !== 'none' && camMode !== null && (
          <button type="button" disabled={busy} onClick={openCamera} className={`${cls.btnPrimary} py-3`}>
            <Camera className="w-5 h-5" /> {t('scan_take_photo')}
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => fileInput.current?.click()} className={`${cls.btnSecondary} py-3 ${camMode === 'none' || camMode === null ? 'sm:col-span-2' : ''}`}>
          <FileUp className="w-5 h-5" /> {t('scan_upload_file')}
        </button>
      </div>
      <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" aria-hidden tabIndex={-1} onChange={(e) => handle(e.target.files?.[0])} />
      {/* capture="environment" : ouvre la caméra arrière sur téléphone ; sans effet (sélecteur de fichier) ailleurs */}
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" aria-hidden tabIndex={-1} onChange={(e) => handle(e.target.files?.[0])} />
      <p className="mt-2 hidden sm:block text-[11px] text-zinc-500 text-start">{t('scan_drop_hint')}</p>

      {status.kind === 'idle' && showSamples && (
        <div className="mt-1 flex flex-wrap gap-x-4 text-xs">
          {SAMPLES.map((s) => (
            <button key={s.file} type="button" className="text-teal-700 hover:underline" onClick={() => trySample(s.file, s.type)}>{t(s.label)}</button>
          ))}
        </div>
      )}

      {status.kind === 'busy' && (
        <div className="mt-3" aria-live="polite">
          <div className="flex justify-between text-xs text-zinc-600 mb-1"><span>{stageLabel(status.p, status.ai)}</span><span className="tabular-nums">{Math.round((status.p?.progress ?? 0) * 100)} %</span></div>
          <div className="h-1.5 rounded-full bg-zinc-200 overflow-hidden"><div className="h-full bg-teal-500 transition-all" style={{ width: `${Math.round((status.p?.progress ?? 0) * 100)}%` }} /></div>
        </div>
      )}
      {status.kind === 'error' && <p className="mt-3 text-sm text-red-600 text-start" role="alert">{t(status.key as 'ocr_failed')}</p>}
      {status.kind === 'done' && (
        <div className="mt-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-start space-y-1">
          <div className="flex flex-wrap items-center gap-2 font-semibold text-zinc-800">
            {status.x.checks.totalsConsistent ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
            {status.x.checks.totalsConsistent ? t('ocr_consistent') : t('ocr_check_totals')}
            {status.ai && <span className="inline-flex items-center gap-1 text-xs font-medium text-violet-700"><Sparkles className="w-3.5 h-3.5" />{t('ocr_ai_refined')}</span>}
          </div>
          <div className="text-xs text-zinc-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>{t('scan_detected_type')} : <b>{t(`doc_kind_${kind ?? 'UNKNOWN'}` as 'doc_kind_INVOICE')}</b></span>
            {status.x.subtotal.value !== null && <span>{t('subtotal')} : <b className="tabular-nums">{f.money(status.x.subtotal.value)}</b></span>}
            {status.x.vatTotal.value !== null && <span>{t('vat')} : <b className="tabular-nums">{f.money(status.x.vatTotal.value)}</b></span>}
            {status.x.fodec.value !== null && <span>FODEC : <b className="tabular-nums">{f.money(status.x.fodec.value)}</b></span>}
            {status.x.stamp.value !== null && <span>{t('stamp_duty')} : <b className="tabular-nums">{f.money(status.x.stamp.value)}</b></span>}
            {status.x.total.value !== null && <span>{t('total_ttc')} : <b className="tabular-nums">{f.money(status.x.total.value)}</b></span>}
          </div>
          <p className="text-xs text-amber-700">{t('ocr_review_hint', { threshold: Math.round(LOW_CONFIDENCE * 100) })}</p>
        </div>
      )}
      <WebcamCapture open={webcamOpen} onClose={() => setWebcamOpen(false)} onCapture={(file) => { setWebcamOpen(false); handle(file) }} onUnavailable={() => { setWebcamOpen(false); setCamMode('none'); setStatus({ kind: 'error', key: 'scan_camera_unavailable' }) }} />
    </section>
  )
}

/** Webcam d'ordinateur (getUserMedia) : aperçu puis capture JPEG. Rendue dans un portail (au-dessus des modales). */
function WebcamCapture({ open, onClose, onCapture, onUnavailable }: { open: boolean; onClose: () => void; onCapture: (f: File) => void; onUnavailable: () => void }) {
  const t = useTranslations('Purchases')
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  const unavailable = useRef(onUnavailable)
  useEffect(() => { unavailable.current = onUnavailable }, [onUnavailable])

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop())
    stream.current = null
    setReady(false)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((tr) => tr.stop()); return }
        stream.current = s
        if (video.current) { video.current.srcObject = s; video.current.play().then(() => setReady(true)).catch(() => setReady(true)) }
      })
      .catch(() => { if (!cancelled) unavailable.current() })
    return () => { cancelled = true; stop() }
  }, [open, stop])

  function capture() {
    const v = video.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')?.drawImage(v, 0, 0)
    c.toBlob((b) => { if (b) onCapture(new File([b], `scan-${Date.now()}.jpg`, { type: 'image/jpeg' })) }, 'image/jpeg', 0.92)
  }

  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-900/70 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t('scan_take_photo')} className="w-full max-w-2xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3">
          <h3 className="font-semibold text-zinc-900 text-start">{t('scan_take_photo')}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100" aria-label={t('cancel')}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4">
          <video ref={video} playsInline muted className="aspect-video w-full rounded-xl bg-zinc-900 object-contain" />
          <p className="mt-2 text-xs text-zinc-500 text-start">{t('scan_webcam_hint')}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          <button type="button" className={cls.btnSecondary} onClick={onClose}>{t('cancel')}</button>
          <button type="button" className={cls.btnPrimary} disabled={!ready} onClick={capture}><Camera className="w-4 h-4" /> {t('scan_capture')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
