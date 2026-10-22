'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from '@/i18n/routing'
import { useTranslations, useLocale } from 'next-intl'
import { readApiError } from '@/lib/client-errors'
import { UserPlus, Save } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import SmartInput from '@/components/ui/SmartInput'
import type { Suggestion } from '@/components/ui/SmartInput'

const SECTORS = ['GARAGE', 'PME_INDUSTRIE', 'COMMERCE', 'SERVICES', 'AUTO_ENTREPRENEUR', 'AUTRE']
const SOURCES = ['WEBSITE', 'LINKEDIN', 'WHATSAPP', 'EMAIL', 'REFERRAL', 'COLD_CALL', 'EVENT', 'OTHER']

// Grandes villes de Tunisie (base de suggestions — la saisie libre reste possible)
const TUNISIA_CITIES = [
  'Tunis', 'Ariana', 'La Marsa', 'Ben Arous', 'Sfax', 'Sousse', 'Kairouan', 'Nabeul',
  'Bizerte', 'Monastir', 'Mahdia', 'Béja', 'Jendouba', 'Kasserine', 'Gabès', 'Médenine',
  'Zaghouan', 'Le Kef', 'Siliana', 'Kef', 'Gafsa', 'Tozeur', 'Gabès', 'Djerba', 'Tabarka',
]

export default function NewLeadPage() {
  const t = useTranslations('CRM')
  const locale = useLocale()
  const { tenantId } = useSession()
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existingLeads, setExistingLeads] = useState<any[]>([])
  const [form, setForm] = useState({
    name: '', company: '', email: '', phone: '', address: '', city: '',
    sector: 'AUTRE', source: 'OTHER', estimatedValue: '', nextFollowUp: '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  // Saisie intelligente : entreprises, villes, contacts déjà saisis dans le CRM
  useEffect(() => {
    if (!tenantId) return
    fetch(`/api/crm/leads?tenantId=${tenantId}`)
      .then(r => (r.ok ? r.json() : []))
      .then((list: any[]) => setExistingLeads(Array.isArray(list) ? list : []))
      .catch(() => {})
  }, [tenantId])

  const companySuggestions: Suggestion[] = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of existingLeads) {
      const c = (l.company || '').trim()
      if (c) counts.set(c, (counts.get(c) || 0) + 1)
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }))
  }, [existingLeads])

  const citySuggestions: Suggestion[] = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of existingLeads) {
      const c = (l.city || '').trim()
      if (c) counts.set(c, (counts.get(c) || 0) + 1)
    }
    for (const c of TUNISIA_CITIES) {
      const k = c
      counts.set(k, counts.get(k) ?? 0)
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }))
  }, [existingLeads])

  const nameSuggestions: Suggestion[] = useMemo(() => {
    const counts = new Map<string, number>()
    for (const l of existingLeads) {
      const n = (l.name || '').trim()
      if (n) counts.set(n, (counts.get(n) || 0) + 1)
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }))
  }, [existingLeads])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const r = await fetch('/api/crm/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          tenantId,
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : null,
          nextFollowUp: form.nextFollowUp || null,
        }),
      })
      if (!r.ok) { setError(await readApiError(r, locale)); return }
      const data = await r.json()
      router.push(data?.id ? `/crm/leads/${data.id}` : '/crm')
    } catch {
      setError(t('form.save_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-black text-stone-900 flex items-center gap-2">
        <UserPlus className="w-6 h-6 text-teal-600" /> {t('form.new_title')}
      </h1>

      <form onSubmit={submit} className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.name')} *</label>
            <SmartInput required value={form.name} onChange={v => set('name', v)} suggestions={nameSuggestions} placeholder={t('form.name_placeholder')}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.company')}</label>
            <SmartInput value={form.company} onChange={v => set('company', v)} suggestions={companySuggestions} placeholder={t('form.company_placeholder')}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.email')}</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="contact@exemple.tn"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.phone')}</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="71 000 000"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.city')}</label>
            <SmartInput value={form.city} onChange={v => set('city', v)} suggestions={citySuggestions} placeholder={t('form.city_placeholder')}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.address')}</label>
            <input value={form.address} onChange={e => set('address', e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.sector')}</label>
            <select value={form.sector} onChange={e => set('sector', e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500">
              {SECTORS.map(s => <option key={s} value={s}>{t(`sectors.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.source')}</label>
            <select value={form.source} onChange={e => set('source', e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500">
              {SOURCES.map(s => <option key={s} value={s}>{t(`sources.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.estimated_value')}</label>
            <input type="number" min="0" step="10" value={form.estimatedValue} onChange={e => set('estimatedValue', e.target.value)} placeholder="350"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">{t('form.next_follow_up')}</label>
            <input type="date" value={form.nextFollowUp} onChange={e => set('nextFollowUp', e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
        </div>

        {error && <p role="alert" className="text-sm font-bold text-red-600">{error}</p>}

        <button type="submit" disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 min-h-[44px] bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-black rounded-xl">
          <Save className="w-4 h-4" /> {saving ? t('form.saving') : t('form.create')}
        </button>
      </form>
    </div>
  )
}
