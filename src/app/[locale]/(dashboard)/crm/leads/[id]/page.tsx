'use client'
import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Link } from '@/i18n/routing'
import {
  ArrowLeft, Trash2, Phone, Mail, MapPin, Building2, Calendar,
  Save, PlusCircle, Clock, ChevronRight
} from 'lucide-react'
import { useSession } from '@/hooks/useSession'

const STATUSES = [
  { key: 'NOUVEAU', label: 'Nouveau' },
  { key: 'CONTACTE', label: 'Contacté' },
  { key: 'DEMO', label: 'Démo' },
  { key: 'NEGOCIATION', label: 'Négociation' },
  { key: 'GAGNE', label: 'Gagné' },
  { key: 'PERDU', label: 'Perdu' },
]

const SECTOR_LABELS: Record<string, string> = {
  GARAGE: 'Garage / Auto', PME_INDUSTRIE: 'PME Industrie', COMMERCE: 'Commerce',
  SERVICES: 'Services', AUTO_ENTREPRENEUR: 'Auto-entrepreneur', AUTRE: 'Autre',
}

const SOURCE_LABELS: Record<string, string> = {
  WEBSITE: 'Site web', LINKEDIN: 'LinkedIn', WHATSAPP: 'WhatsApp', EMAIL: 'Email',
  REFERRAL: 'Recommandation', COLD_CALL: 'Prospection à froid', EVENT: 'Événement', OTHER: 'Autre',
}

const STATUS_STYLE: Record<string, string> = {
  NOUVEAU: 'bg-stone-100 text-stone-600 border-stone-300',
  CONTACTE: 'bg-blue-100 text-blue-700 border-blue-300',
  DEMO: 'bg-violet-100 text-violet-700 border-violet-300',
  NEGOCIATION: 'bg-amber-100 text-amber-700 border-amber-300',
  GAGNE: 'bg-teal-100 text-teal-700 border-teal-300',
  PERDU: 'bg-red-100 text-red-600 border-red-300',
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { tenantId, session } = useSession()
  const [lead, setLead] = useState<any>(null)
  const [notes, setNotes] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [addingNote, setAddingNote] = useState(false)
  const [form, setForm] = useState<any>({})
  const [formDirty, setFormDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return }
    try {
      const r = await fetch(`/api/crm/leads/${params.id}?tenantId=${tenantId}`)
      if (r.ok) {
        const data = await r.json()
        setLead(data)
        setNotes(data.notes || [])
        setForm({
          name: data.name || '', company: data.company || '', email: data.email || '',
          phone: data.phone || '', address: data.address || '', city: data.city || '',
          sector: data.sector, source: data.source, status: data.status,
          estimatedValue: data.estimatedValue ? String(data.estimatedValue) : '',
          nextFollowUp: data.nextFollowUp ? new Date(data.nextFollowUp).toISOString().slice(0, 10) : '',
          notes: data.notes || '',
        })
        setFormDirty(false)
      }
    } finally {
      setLoading(false)
    }
  }, [params.id, tenantId])

  useEffect(() => { load() }, [load])

  const set = (k: string, v: string) => { setForm((f: any) => ({ ...f, [k]: v })); setFormDirty(true) }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      const r = await fetch(`/api/crm/leads/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          ...form,
          estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : null,
          nextFollowUp: form.nextFollowUp ? new Date(form.nextFollowUp).toISOString() : null,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Erreur')
      setFormDirty(false)
      load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const del = async () => {
    if (!confirm('Supprimer ce lead ? Cette action est irréversible.')) return
    setDeleting(true)
    try {
      const r = await fetch(`/api/crm/leads/${params.id}?tenantId=${tenantId}`, { method: 'DELETE' })
      if (r.ok) router.push('/crm')
    } finally {
      setDeleting(false)
    }
  }

  const addNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newNote.trim()) return
    setAddingNote(true)
    try {
      const r = await fetch(`/api/crm/leads/${params.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, leadId: params.id, content: newNote.trim(), author: session?.firstName || session?.email || 'Admin' }),
      })
      if (r.ok) {
        setNewNote('')
        load()
      }
    } finally {
      setAddingNote(false)
    }
  }

  if (loading) return <div className="py-24 text-center text-stone-400 font-bold">Chargement...</div>
  if (!lead) return <div className="py-24 text-center text-stone-400 font-bold">Lead introuvable</div>

  const statusMeta = STATUSES.find(s => s.key === lead.status) || STATUSES[0]

  return (
    <div className="space-y-5">
      {/* Breadcrumb + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/crm" className="p-2 border border-stone-200 rounded-xl bg-white hover:bg-stone-50">
            <ArrowLeft className="w-4 h-4 text-stone-500" />
          </Link>
          <div>
            <h1 className="text-xl font-black text-stone-900">{lead.name}</h1>
            <p className="text-stone-400 text-xs font-bold font-mono">{lead.code}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className={`px-3 py-2 text-sm font-black rounded-xl border ${STATUS_STYLE[form.status]}`}>
            {STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <button onClick={del} disabled={deleting}
            className="flex items-center gap-2 px-3 py-2 text-sm font-bold border border-red-200 text-red-600 rounded-xl bg-white hover:bg-red-50 disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> {deleting ? '...' : 'Supprimer'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Main form */}
        <form onSubmit={save} className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-black text-stone-600 mb-1.5 block">Nom du contact *</label>
              <input value={form.name} onChange={e => set('name', e.target.value)} required
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
            </div>
            <div>
              <label className="text-xs font-black text-stone-600 mb-1.5 block">Entreprise</label>
              <input value={form.company} onChange={e => set('company', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
            </div>
            <div>
              <label className="text-xs font-black text-stone-600 mb-1.5 block">Email</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
            </div>
            <div>
              <label className="text-xs font-black text-stone-600 mb-1.5 block">Téléphone</label>
              <input value={form.phone} onChange={e => set('phone', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
            </div>
            <div>
              <label className="text-xs font-black text-stone-600 mb-1.5 block">Ville</label>
              <input value={form.city} onChange={e => set('city', e.target.value)}
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
                {Object.entries(SECTOR_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-black text-stone-600 mb-1.5 block">Source</label>
              <select value={form.source} onChange={e => set('source', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500">
                {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-black text-stone-600 mb-1.5 block">Valeur estimée (DT)</label>
              <input type="number" min="0" step="10" value={form.estimatedValue} onChange={e => set('estimatedValue', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
            </div>
            <div>
              <label className="text-xs font-black text-stone-600 mb-1.5 block">Prochaine relance</label>
              <input type="date" value={form.nextFollowUp} onChange={e => set('nextFollowUp', e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
            </div>
          </div>
          <div>
            <label className="text-xs font-black text-stone-600 mb-1.5 block">Notes internes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
          </div>

          {error && <p className="text-sm font-bold text-red-600">{error}</p>}

          <div className="flex justify-end">
            <button type="submit" disabled={saving || !formDirty}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white font-black rounded-xl">
              <Save className="w-4 h-4" /> {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </form>

        {/* Sidebar info + notes */}
        <div className="space-y-5">
          {/* Contact quick info */}
          <div className="bg-white border border-stone-200 rounded-2xl p-5 space-y-3">
            <h3 className="font-black text-stone-900 text-sm">Informations</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-start gap-2.5">
                <Building2 className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                <span className="font-bold text-stone-700">{lead.company || '—'}</span>
              </div>
              <div className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                <span className="font-bold text-stone-700">{lead.city || '—'}{lead.address ? `, ${lead.address}` : ''}</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Phone className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                <span className="font-bold text-stone-700">{lead.phone || '—'}</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Mail className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                <span className="font-bold text-stone-700 break-all">{lead.email || '—'}</span>
              </div>
              <div className="flex items-start gap-2.5">
                <Calendar className="w-4 h-4 text-stone-400 mt-0.5 shrink-0" />
                <span className="font-bold text-stone-700">
                  Créé le {new Date(lead.createdAt).toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </span>
              </div>
            </div>
          </div>

          {/* Notes timeline */}
          <div className="bg-white border border-stone-200 rounded-2xl p-5">
            <h3 className="font-black text-stone-900 text-sm mb-3">Historique des échanges ({notes.length})</h3>
            <form onSubmit={addNote} className="mb-4">
              <textarea value={newNote} onChange={e => setNewNote(e.target.value)} rows={2} placeholder="Ajouter une note..."
                className="w-full px-3 py-2.5 text-sm border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500" />
              <button type="submit" disabled={addingNote || !newNote.trim()}
                className="mt-2 flex items-center gap-1.5 text-xs font-black text-teal-700 hover:text-teal-800 disabled:opacity-40">
                <PlusCircle className="w-4 h-4" /> Ajouter
              </button>
            </form>
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {notes.length === 0 ? (
                <p className="text-stone-400 text-xs font-bold text-center py-4">Aucune note</p>
              ) : notes.map(n => (
                <div key={n.id} className="border-l-2 border-teal-300 pl-3">
                  <div className="flex items-center gap-2 text-[10px] font-black text-stone-400">
                    <Clock className="w-3 h-3" />
                    {n.author || 'Admin'}
                    <span className="ml-auto">{new Date(n.createdAt).toLocaleDateString('fr-TN', { day: '2-digit', month: 'short' })}</span>
                  </div>
                  <p className="text-sm text-stone-700 font-bold mt-1">{n.content}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
