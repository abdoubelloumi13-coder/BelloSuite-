'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from "next/navigation"
import { UserPlus, Save } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import SmartInput from '@/components/ui/SmartInput'
import type { Suggestion } from '@/components/ui/SmartInput'

const SECTORS = [
  { value: 'GARAGE', label: 'Garage / Auto' },
  { value: 'PME_INDUSTRIE', label: 'PME Industrie' },
  { value: 'COMMERCE', label: 'Commerce' },
  { value: 'SERVICES', label: 'Services' },
  { value: 'AUTO_ENTREPRENEUR', label: 'Auto-entrepreneur' },
  { value: 'AUTRE', label: 'Autre' },
]

const SOURCES = [
  { value: 'WEBSITE', label: 'Site web' },
  { value: 'LINKEDIN', label: 'LinkedIn' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'REFERRAL', label: 'Recommandation' },
  { value: 'COLD_CALL', label: 'Prospection à froid' },
  { value: 'EVENT', label: 'Événement' },
  { value: 'OTHER', label: 'Autre' },
]

// Grandes villes de Tunisie (base de suggestions — la saisie libre reste possible)
const TUNISIA_CITIES = [
  'Tunis', 'Ariana', 'La Marsa', 'Ben Arous', 'Sfax', 'Sousse', 'Kairouan', 'Nabeul',
  'Bizerte', 'Monastir', 'Mahdia', 'Béja', 'Jendouba', 'Kasserine', 'Gabès', 'Médenine',
  'Zaghouan', 'Le Kef', 'Siliana', 'Kef', 'Gafsa', 'Tozeur', 'Gabès', 'Djerba', 'Tabarka',
]

export default function NewLeadPage() {
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
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Erreur inconnue')
      router.push(`/crm/leads/${data.id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-2xl font-black text-stone-900 flex items-center gap-2">
        <UserPlus className="w-6 h-6 text-teal-600" /> Nouveau lead
      </h1>

      <form onSubmit={submit} className="bg-white border border-stone-200 rounded-2xl p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Nom du contact *</label>
            <SmartInput required value={form.name} onChange={v => set('name', v)} suggestions={nameSuggestions} placeholder="Ex : Ahmed Ben Salah"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Entreprise</label>
            <SmartInput value={form.company} onChange={v => set('company', v)} suggestions={companySuggestions} placeholder="Ex : Garage El Fath"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="contact@exemple.tn"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Téléphone</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="71 000 000"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Ville</label>
            <SmartInput value={form.city} onChange={v => set('city', v)} suggestions={citySuggestions} placeholder="Tunis, Sfax..."
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Adresse</label>
            <input value={form.address} onChange={e => set('address', e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Secteur</label>
            <select value={form.sector} onChange={e => set('sector', e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500">
              {SECTORS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Source</label>
            <select value={form.source} onChange={e => set('source', e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500">
              {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Valeur estimée (DT)</label>
            <input type="number" min="0" step="10" value={form.estimatedValue} onChange={e => set('estimatedValue', e.target.value)} placeholder="350"
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Prochaine relance</label>
            <input type="date" value={form.nextFollowUp} onChange={e => set('nextFollowUp', e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>
        </div>

        {error && <p className="text-sm font-bold text-red-600">{error}</p>}

        <button type="submit" disabled={saving}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 min-h-[44px] bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white font-black rounded-xl">
          <Save className="w-4 h-4" /> {saving ? 'Enregistrement...' : 'Créer le lead'}
        </button>
      </form>
    </div>
  )
}
