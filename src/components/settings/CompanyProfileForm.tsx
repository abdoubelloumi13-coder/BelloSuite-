'use client'

/**
 * Profil légal de l'entreprise émettrice (raison sociale, matricule fiscal, adresse, RIB…),
 * utilisé par le TEIF El Fatoora et l'impression des factures. Enregistré via PUT /api/tenant/company.
 */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Building2, CheckCircle2, AlertTriangle, Loader2, Save } from 'lucide-react'
import { readApiError } from '@/lib/zod-helpers'
import { fetchWithTimeout } from '@/lib/fetch-timeout'
import { isValidMatricule, normalizeMatricule, isValidRib, normalizeRib } from '@/lib/matricule'

interface Profile {
  name: string
  matriculeFiscal: string
  address: string
  city: string
  zipCode: string
  phone: string
  email: string
  rib: string
}

const EMPTY: Profile = { name: '', matriculeFiscal: '', address: '', city: '', zipCode: '', phone: '', email: '', rib: '' }

const inputCls = 'w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-xl px-3 py-2 text-sm text-stone-900 dark:text-white focus:border-teal-500 outline-none text-start'
const labelCls = 'text-[10px] font-black text-stone-500 dark:text-zinc-400 uppercase tracking-widest'

export function CompanyProfileForm({ tenantId }: { tenantId: string | null }) {
  const t = useTranslations('Settings.company')
  const [form, setForm] = useState<Profile>(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!tenantId) return
    fetchWithTimeout(`/api/tenant/company?tenantId=${encodeURIComponent(tenantId)}`, {}, 20_000)
      .then(async r => {
        if (!r.ok) throw new Error(await readApiError(r, t('load_error')))
        const d = await r.json()
        setForm({
          name: d.name || '', matriculeFiscal: d.matriculeFiscal || '', address: d.address || '', city: d.city || '',
          zipCode: d.zipCode || '', phone: d.phone || '', email: d.email || '', rib: d.rib || '',
        })
      })
      .catch(e => setError(e instanceof Error && e.message ? e.message : t('load_error')))
      .finally(() => setLoaded(true))
  }, [tenantId, t])

  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setSaved(false)
    setForm(f => ({ ...f, [k]: e.target.value }))
  }

  const mfInvalid = !!form.matriculeFiscal.trim() && !isValidMatricule(form.matriculeFiscal)
  const ribInvalid = !!form.rib.trim() && !isValidRib(form.rib)
  const teifReady = isValidMatricule(form.matriculeFiscal) && !!form.address.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setSaved(false)
    if (mfInvalid) { setError(t('matricule_invalid')); return }
    if (ribInvalid) { setError(t('rib_invalid')); return }
    setSaving(true)
    try {
      const body = {
        ...form,
        matriculeFiscal: form.matriculeFiscal.trim() ? normalizeMatricule(form.matriculeFiscal) : '',
        rib: form.rib.trim() ? normalizeRib(form.rib) : '',
        tenantId,
      }
      const res = await fetchWithTimeout('/api/tenant/company', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, 20_000)
      if (!res.ok) { setError(await readApiError(res, t('save_error'))); return }
      const d = await res.json()
      setForm(f => ({ ...f, matriculeFiscal: d.matriculeFiscal || '', rib: d.rib || '' }))
      setSaved(true)
    } catch {
      setError(t('save_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="company" className="scroll-mt-24 p-6 rounded-2xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-500/10 text-teal-600"><Building2 className="w-5 h-5" /></div>
        <div>
          <h2 className="font-black text-stone-900 dark:text-white">{t('title')}</h2>
          <p className="text-xs text-stone-500 mt-0.5">{t('hint')}</p>
        </div>
      </div>

      {!loaded ? (
        <div className="h-40 bg-stone-100 dark:bg-zinc-800 rounded-xl animate-pulse" />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold ${teifReady ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400'}`}>
            {teifReady ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
            {teifReady ? t('teif_ok') : t('teif_missing')}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 md:col-span-2 block">
              <span className={labelCls}>{t('name')}</span>
              <input required value={form.name} onChange={set('name')} className={inputCls} />
            </label>
            <label className="space-y-1 block">
              <span className={labelCls}>{t('matricule')}</span>
              <input value={form.matriculeFiscal} onChange={set('matriculeFiscal')} placeholder="1234567/A/A/M/000"
                aria-invalid={mfInvalid} aria-describedby="company-mf-hint"
                className={`${inputCls} font-mono ${mfInvalid ? 'border-red-400 dark:border-red-500' : ''}`} />
              <span id="company-mf-hint" className={`text-[11px] ${mfInvalid ? 'text-red-600 font-bold' : 'text-stone-500'}`}>
                {mfInvalid ? t('matricule_invalid') : t('matricule_hint')}
              </span>
            </label>
            <label className="space-y-1 block">
              <span className={labelCls}>{t('rib')}</span>
              <input value={form.rib} onChange={set('rib')} inputMode="numeric" aria-invalid={ribInvalid}
                className={`${inputCls} font-mono ${ribInvalid ? 'border-red-400 dark:border-red-500' : ''}`} />
              <span className={`text-[11px] ${ribInvalid ? 'text-red-600 font-bold' : 'text-stone-500'}`}>{ribInvalid ? t('rib_invalid') : t('rib_hint')}</span>
            </label>
            <label className="space-y-1 md:col-span-2 block">
              <span className={labelCls}>{t('address')}</span>
              <textarea rows={2} value={form.address} onChange={set('address')} className={inputCls} />
            </label>
            <label className="space-y-1 block">
              <span className={labelCls}>{t('city')}</span>
              <input value={form.city} onChange={set('city')} className={inputCls} />
            </label>
            <label className="space-y-1 block">
              <span className={labelCls}>{t('zip')}</span>
              <input value={form.zipCode} onChange={set('zipCode')} inputMode="numeric" className={inputCls} />
            </label>
            <label className="space-y-1 block">
              <span className={labelCls}>{t('phone')}</span>
              <input value={form.phone} onChange={set('phone')} type="tel" className={inputCls} />
            </label>
            <label className="space-y-1 block">
              <span className={labelCls}>{t('email')}</span>
              <input value={form.email} onChange={set('email')} type="email" className={inputCls} />
            </label>
          </div>

          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/30 px-3 py-2 text-sm font-bold text-red-700 dark:text-red-400">{error}</p>}
          {saved && <p role="status" className="text-sm font-bold text-emerald-600 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> {t('saved')}</p>}

          <div className="flex justify-end">
            <button type="submit" disabled={saving || !tenantId}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-sm font-black disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} {saving ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
