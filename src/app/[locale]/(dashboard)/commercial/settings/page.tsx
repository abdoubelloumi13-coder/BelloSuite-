'use client'

/**
 * Paramètres commerciaux — carte « Signature électronique » (facture électronique El Fatoora).
 * Mode simulation : clé de test locale ou DigiGo simulé ; TunTrust réel « bientôt ».
 */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, BadgeCheck, ChevronRight, Loader2, PenLine, Save } from 'lucide-react'
import { Link } from '@/i18n/routing'

type Mode = 'local' | 'digigo-mock' | 'tuntrust'
interface Settings { mode: Mode; signerName: string; signerRole: string; signerEmail: string }
interface CertSummary { subject: string; issuer: string; serialNumber: string; validFrom: string; validTo: string; fingerprint256: string }
interface TestCert { signer: CertSummary; subCa: CertSummary; root: CertSummary; label: string }

export default function CommercialSettingsPage() {
  const t = useTranslations('EInvoice.settings')
  const te = useTranslations('EInvoice')
  const [form, setForm] = useState<Settings>({ mode: 'local', signerName: '', signerRole: 'Gérant', signerEmail: '' })
  const [cert, setCert] = useState<TestCert | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/commercial/einvoice/settings')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error())))
      .then(d => { setForm(d.settings); setCert(d.testCertificate) })
      .catch(() => setMessage({ ok: false, text: t('load_failed') }))
      .finally(() => setLoading(false))
  }, [t])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setMessage(null)
    try {
      const res = await fetch('/api/commercial/einvoice/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok) throw new Error(d?.error || t('save_failed'))
      setForm(d.settings)
      setMessage({ ok: true, text: t('saved') })
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t('save_failed') })
    } finally { setSaving(false) }
  }

  const modes: { id: Mode; label: string; hint: string; disabled?: boolean }[] = [
    { id: 'local', label: t('mode_local'), hint: t('mode_local_hint') },
    { id: 'digigo-mock', label: t('mode_digigo'), hint: t('mode_digigo_hint') },
    { id: 'tuntrust', label: t('mode_tuntrust'), hint: t('mode_tuntrust_hint'), disabled: true },
  ]
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('fr-TN', { timeZone: 'Africa/Tunis' })
  const input = 'w-full rounded-xl border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 px-4 py-2.5 text-sm text-stone-900 dark:text-white'

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6 text-start">
      <div>
        <h1 className="text-3xl font-black text-stone-900 dark:text-white tracking-tight">{t('page_title')}</h1>
        <p className="text-stone-500 dark:text-zinc-400 font-medium mt-1">{t('page_subtitle')}</p>
      </div>

      <section className="rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-6 space-y-5" aria-labelledby="sig-title">
        <div className="flex items-center gap-3">
          <PenLine className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          <div>
            <h2 id="sig-title" className="font-black text-lg text-stone-900 dark:text-white">{t('card_title')}</h2>
            <p className="text-xs text-stone-500 dark:text-zinc-400">{t('card_subtitle')}</p>
          </div>
        </div>

        <div role="note" className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 dark:bg-orange-500/10 dark:border-orange-500/30 px-4 py-3">
          <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5" />
          <p className="text-sm font-bold text-orange-800 dark:text-orange-300">{te('simulation_banner')} — {te('simulation_banner_detail')}</p>
        </div>

        {loading ? (
          <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
        ) : (
          <form onSubmit={save} className="space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-[10px] font-black uppercase tracking-widest text-stone-500 dark:text-zinc-500 mb-2">{t('mode')}</legend>
              {modes.map(m => (
                <label key={m.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${m.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} ${form.mode === m.id ? 'border-purple-400 bg-purple-50 dark:bg-purple-500/10' : 'border-stone-200 dark:border-zinc-800'}`}>
                  <input type="radio" name="mode" value={m.id} disabled={m.disabled} checked={form.mode === m.id}
                    onChange={() => setForm(f => ({ ...f, mode: m.id }))} className="mt-1" />
                  <span>
                    <span className="font-bold text-sm text-stone-900 dark:text-white">{m.label}</span>
                    {m.disabled && <span className="ms-2 text-[10px] font-black uppercase rounded-full bg-stone-200 dark:bg-zinc-800 px-2 py-0.5">{t('soon')}</span>}
                    <span className="block text-xs text-stone-500 dark:text-zinc-400">{m.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1">
                <span className="text-xs font-bold text-stone-600 dark:text-zinc-400">{t('signer_name')}</span>
                <input className={input} value={form.signerName} maxLength={120} onChange={e => setForm(f => ({ ...f, signerName: e.target.value }))} />
              </label>
              <label className="space-y-1">
                <span className="text-xs font-bold text-stone-600 dark:text-zinc-400">{t('signer_role')}</span>
                <input className={input} value={form.signerRole} maxLength={100} placeholder={t('signer_role_placeholder')} onChange={e => setForm(f => ({ ...f, signerRole: e.target.value }))} />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs font-bold text-stone-600 dark:text-zinc-400">{t('signer_email')}</span>
                <input type="email" className={input} value={form.signerEmail} maxLength={160} placeholder="signature-test@bellosuite.tn" onChange={e => setForm(f => ({ ...f, signerEmail: e.target.value }))} />
                <span className="block text-[11px] text-stone-400">{t('signer_email_hint')}</span>
              </label>
            </div>

            {cert && (
              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/50 p-4 space-y-2">
                <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-stone-500 dark:text-zinc-500">
                  <BadgeCheck className="w-4 h-4" /> {t('test_cert')}
                </p>
                <dl className="grid grid-cols-1 md:grid-cols-[10rem_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="font-bold text-stone-500">{t('cert_subject')}</dt><dd className="font-mono break-all">{cert.signer.subject}</dd>
                  <dt className="font-bold text-stone-500">{t('cert_issuer')}</dt><dd className="font-mono break-all">{cert.signer.issuer}</dd>
                  <dt className="font-bold text-stone-500">{t('cert_serial')}</dt><dd className="font-mono">{cert.signer.serialNumber}</dd>
                  <dt className="font-bold text-stone-500">{t('cert_validity')}</dt><dd>{fmt(cert.signer.validFrom)} → {fmt(cert.signer.validTo)}</dd>
                  <dt className="font-bold text-stone-500">{t('cert_fingerprint')}</dt><dd className="font-mono break-all">{cert.signer.fingerprint256}</dd>
                  <dt className="font-bold text-stone-500">{t('cert_chain')}</dt><dd className="font-mono break-all">{cert.subCa.subject.split('CN=').pop()} → {cert.root.subject.split('CN=').pop()}</dd>
                </dl>
              </div>
            )}

            {message && (
              <p className={`text-sm font-bold ${message.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{message.text}</p>
            )}
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-black text-sm disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {t('save')}
            </button>
          </form>
        )}
      </section>

      <Link href="/commercial/settings/ttn" className="flex items-center justify-between rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 hover:bg-stone-50 dark:hover:bg-zinc-800 text-sm font-bold text-stone-700 dark:text-zinc-300">
        {t('asp_link')} <ChevronRight className="w-4 h-4 rtl:rotate-180" />
      </Link>
    </div>
  )
}
