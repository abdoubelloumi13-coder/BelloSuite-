'use client'

/**
 * Speech-to-Devis : dictée vocale (Web Speech API du navigateur) → texte modifiable → analyse serveur
 * (/api/ai/dictate-quote) → aperçu à confirmer → lignes insérées dans le formulaire. Rien n'est enregistré ici.
 * Navigateur sans reconnaissance vocale (Firefox…) : message + saisie du texte au clavier.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Mic, Square, X, Wand2, ArrowLeft, Check, AlertTriangle, Package, User } from 'lucide-react'
import { speechLangFor, type DictatedQuote } from '@/lib/dictate-quote'

// Types minimaux de la Web Speech API (absente de lib.dom selon les versions de TypeScript)
type SRAlternative = { transcript: string }
type SRResult = { isFinal: boolean; 0: SRAlternative; length: number }
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> }
type SRErrorEvent = { error: string }
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SREvent) => void) | null
  onerror: ((e: SRErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SRConstructor = new () => SpeechRecognitionLike

function getRecognitionCtor(): SRConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SRConstructor; webkitSpeechRecognition?: SRConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

type ProductLite = { id: string; name: string; salePrice?: unknown }
type ClientLite = { id: string; name: string }

/** Monté seulement quand la boîte est ouverte : `{open && <DictateQuoteDialog … />}`. */
interface Props {
  onClose: () => void
  onApply: (q: DictatedQuote) => void
  products: ProductLite[]
  clients: ClientLite[]
}

const LANGS = ['fr-FR', 'ar-TN', 'en-US'] as const

export default function DictateQuoteDialog({ onClose, onApply, products, clients }: Props) {
  const t = useTranslations('Commercial.DocumentEditor.dictation')
  const locale = useLocale()
  const [lang, setLang] = useState<string>(speechLangFor(locale))
  // rendu uniquement après un clic (jamais côté serveur) : détection directe, sans effet
  const [supported, setSupported] = useState(() => getRecognitionCtor() !== null)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [speechError, setSpeechError] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ result: DictatedQuote; provider: string } | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)

  // démontage (fermeture) : micro coupé ; l'état repart à vide à la prochaine ouverture
  useEffect(() => () => { recRef.current?.abort() }, [])

  const start = () => {
    const Ctor = getRecognitionCtor()
    if (!Ctor) { setSupported(false); return }
    setSpeechError('')
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.onresult = (e) => {
      let finalText = ''
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finalText += r[0].transcript
        else interimText += r[0].transcript
      }
      if (finalText.trim()) setTranscript((prev) => (prev.trim() ? `${prev.trim()} ${finalText.trim()}` : finalText.trim()))
      setInterim(interimText)
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setSpeechError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? t('permission_denied') : t('speech_error'))
    }
    rec.onend = () => { setListening(false); setInterim(''); recRef.current = null }
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setSpeechError(t('speech_error'))
      recRef.current = null
    }
  }

  const stop = () => { recRef.current?.stop() }

  const analyze = async () => {
    if (listening) stop()
    const text = transcript.trim()
    if (!text) return
    setAnalyzing(true)
    setError('')
    try {
      const res = await fetch('/api/ai/dictate-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, locale: ['fr', 'en', 'ar'].includes(locale) ? locale : 'fr' }),
      })
      if (res.status === 429) { setError(t('errors.rate_limited')); return }
      if (!res.ok) { setError(t('errors.generic')); return }
      const data = await res.json() as { provider: string; result: DictatedQuote }
      setPreview({ result: data.result, provider: data.provider })
    } catch {
      setError(t('errors.generic'))
    } finally {
      setAnalyzing(false)
    }
  }

  const fmt = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-TN' : locale === 'en' ? 'en-GB' : 'fr-TN', { maximumFractionDigits: 3 })
  const productOf = (id: string | null) => (id ? products.find((p) => p.id === id) : undefined)
  const clientOf = (id: string | null) => (id ? clients.find((c) => c.id === id) : undefined)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="dictate-title">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2rem] shadow-2xl p-6 md:p-8 space-y-5 text-start">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="dictate-title" className="text-xl font-black text-stone-900 dark:text-white flex items-center gap-2">
              <Mic className="w-5 h-5 text-teal-600" /> {preview ? t('preview_title') : t('title')}
            </h2>
            <p className="text-xs text-stone-500 mt-1">{t('subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-stone-400 hover:text-stone-900 rounded-xl" aria-label={t('close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{error}</span>
          </div>
        )}

        {!preview ? (
          <>
            {supported ? (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <label htmlFor="dictate-lang" className="text-[10px] font-black text-stone-500 uppercase tracking-widest">{t('language')}</label>
                  <select
                    id="dictate-lang"
                    value={lang}
                    disabled={listening}
                    onChange={(e) => setLang(e.target.value)}
                    className="block bg-stone-50 border border-stone-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-teal-500"
                  >
                    {LANGS.map((l) => <option key={l} value={l}>{t(`lang.${l.slice(0, 2)}`)}</option>)}
                  </select>
                </div>
                {listening ? (
                  <button type="button" onClick={stop} className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl font-black text-sm">
                    <Square className="w-4 h-4" /> {t('stop')}
                  </button>
                ) : (
                  <button type="button" onClick={start} className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-black text-sm">
                    <Mic className="w-4 h-4" /> {t('start')}
                  </button>
                )}
                {listening && (
                  <span className="flex items-center gap-2 text-xs font-bold text-red-600" aria-live="polite">
                    <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" /> {t('listening')}
                  </span>
                )}
              </div>
            ) : (
              <p className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-sm font-medium">{t('unsupported')}</p>
            )}

            {speechError && <p role="alert" className="text-sm font-bold text-red-600">{speechError}</p>}

            <div className="space-y-1">
              <label htmlFor="dictate-text" className="text-[10px] font-black text-stone-500 uppercase tracking-widest">{t('transcript_label')}</label>
              <textarea
                id="dictate-text"
                rows={5}
                dir="auto"
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder={t('transcript_placeholder')}
                className="w-full bg-stone-50 border border-stone-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-teal-500 font-medium text-stone-900"
              />
              {interim && <p className="text-sm italic text-stone-400" dir="auto" aria-live="polite">{interim}</p>}
              <p className="text-[11px] text-stone-400">{t('privacy')}</p>
            </div>

            <div className="flex justify-end gap-3">
              <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-stone-500 hover:bg-stone-100">{t('cancel')}</button>
              <button
                type="button"
                onClick={analyze}
                disabled={analyzing || !transcript.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-stone-900 hover:bg-stone-700 text-white rounded-xl font-black text-sm disabled:opacity-40"
              >
                <Wand2 className="w-4 h-4" /> {analyzing ? t('analyzing') : t('analyze')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-[10px] font-black uppercase tracking-widest text-stone-400">
              {preview.provider === 'local' ? t('source_local') : t('source_ai')}
            </p>

            <div className="flex items-center gap-2 text-sm">
              <User className="w-4 h-4 text-stone-400" />
              <span className="font-black text-stone-500">{t('client')} :</span>
              {clientOf(preview.result.clientId) ? (
                <span className="font-bold text-stone-900">{clientOf(preview.result.clientId)!.name}</span>
              ) : preview.result.clientName ? (
                <span className="font-bold text-amber-700">{t('client_unmatched', { name: preview.result.clientName })}</span>
              ) : (
                <span className="text-stone-400">{t('no_client')}</span>
              )}
            </div>

            {preview.result.lines.length ? (
              <ul className="divide-y divide-stone-100 border border-stone-100 rounded-2xl">
                {preview.result.lines.map((l, i) => {
                  const p = productOf(l.productId)
                  const price = l.unitPrice ?? (p ? Number(p.salePrice ?? 0) : null)
                  return (
                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-bold text-stone-900 truncate" dir="auto">{p ? p.name : l.description}</p>
                        <p className="text-[11px] font-bold flex items-center gap-1 text-stone-400">
                          <Package className="w-3 h-3" />
                          {p ? <span className="text-teal-600">{t('line_catalog')}</span> : <span className="text-amber-600">{t('line_free')}</span>}
                          {l.discount ? <span>· {t('discount_badge', { value: fmt(l.discount) })}</span> : null}
                        </p>
                      </div>
                      <div className="text-end shrink-0 font-mono text-xs">
                        <p className="font-bold text-stone-900">{fmt(l.quantity)}{l.unit ? ` ${l.unit}` : ''} × {price !== null ? fmt(price) : '—'}</p>
                        <p className="text-stone-400">{l.unitPrice === null && p ? t('catalog_price') : t('unit_price')}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-sm font-medium">{t('no_lines')}</p>
            )}

            {(preview.result.validityDays || preview.result.notes) && (
              <div className="text-xs text-stone-500 space-y-1">
                {preview.result.validityDays ? <p>{t('validity', { days: preview.result.validityDays })}</p> : null}
                {preview.result.notes ? <p dir="auto">{t('notes')} : {preview.result.notes}</p> : null}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3">
              <button type="button" onClick={() => setPreview(null)} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-stone-600 hover:bg-stone-100">
                <ArrowLeft className={`w-4 h-4 ${locale === 'ar' ? 'rotate-180' : ''}`} /> {t('back')}
              </button>
              <button
                type="button"
                disabled={!preview.result.lines.length && !preview.result.clientId}
                onClick={() => { onApply(preview.result); onClose() }}
                className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-black text-sm disabled:opacity-40"
              >
                <Check className="w-4 h-4" /> {t('insert')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
