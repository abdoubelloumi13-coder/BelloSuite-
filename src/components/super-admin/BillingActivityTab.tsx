'use client'
/**
 * Super admin — Activité & facturation (interface interne plateforme, en français).
 * Suivi par entreprise : utilisateurs, activité 30 j, modules activés, sièges, prix négocié, remise,
 * facture mensuelle HT/TTC ; catalogue des modules (prix, utilisateurs inclus, prix/utilisateur).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Building2, ChevronDown, ChevronUp, Download, Save, Search, TrendingUp, Users, AlertTriangle } from 'lucide-react'
import { moduleCharge } from '@/lib/super-admin/billing'

interface CatalogModule { id: string; name: string; displayName: string; icon: string | null; isActive: boolean; monthlyPrice: number; pricePerUser: number; includedUsers: number }
interface TM { moduleId: string; isEnabled: boolean; seats: number; priceOverride: number | null; discountPercent: number }
interface Line { moduleId: string; displayName: string; users: number; extraUsers: number; base: number; usersAmount: number; discount: number; total: number }
interface TenantRow {
  id: string; name: string; subdomain: string; isActive: boolean; createdAt: string; email: string | null; city: string | null
  activeUsers: number; modules: TM[]
  invoice: { lines: Line[]; totalHT: number; tva: number; totalTTC: number }
  activity: { invoices: number; posOrders: number; entries: number; payslips: number; docs30d: number; lastActivity: string | null; score: number; idleDays: number | null; status: 'never' | 'active' | 'slowing' | 'dormant' }
}
interface Data {
  summary: { tenants: number; activeTenants: number; mrrHT: number; dormant: number; users: number; byModule: { moduleId: string; name: string; tenants: number; users: number; revenueHT: number }[] }
  tenants: TenantRow[]; modules: CatalogModule[]
}

const dt = (v: number) => new Intl.NumberFormat('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v || 0)
const STATUS: Record<TenantRow['activity']['status'], [string, string]> = {
  active: ['Actif', 'bg-emerald-500/15 text-emerald-400'],
  slowing: ['Ralentit', 'bg-amber-500/15 text-amber-400'],
  dormant: ['Dormant', 'bg-red-500/15 text-red-400'],
  never: ['Jamais utilisé', 'bg-zinc-700/40 text-zinc-400'],
}

export default function BillingActivityTab() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | TenantRow['activity']['status']>('all')
  const [sort, setSort] = useState<'mrr' | 'activity' | 'users' | 'recent'>('mrr')
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, TM>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [catalogDraft, setCatalogDraft] = useState<Record<string, CatalogModule>>({})

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch('/api/super-admin/billing')
      const json = await res.json().catch(() => null)
      if (!res.ok) { setError(json?.error || 'Chargement impossible'); return }
      setData(json)
      setCatalogDraft(Object.fromEntries((json.modules as CatalogModule[]).map(m => [m.id, { ...m }])))
    } catch { setError('Chargement impossible') }
  }, [])
  useEffect(() => { const id = setTimeout(() => { void load() }, 0); return () => clearTimeout(id) }, [load])

  const rows = useMemo(() => {
    if (!data) return []
    const s = q.trim().toLowerCase()
    const list = data.tenants.filter(t => (filter === 'all' || t.activity.status === filter) && (!s || `${t.name} ${t.subdomain} ${t.email ?? ''} ${t.city ?? ''}`.toLowerCase().includes(s)))
    const key = { mrr: (t: TenantRow) => t.invoice.totalHT, activity: (t: TenantRow) => t.activity.docs30d, users: (t: TenantRow) => t.activeUsers, recent: (t: TenantRow) => new Date(t.createdAt).getTime() }[sort]
    return [...list].sort((a, b) => key(b) - key(a))
  }, [data, q, filter, sort])

  const toggleOpen = (t: TenantRow) => {
    setMsg('')
    if (open === t.id) { setOpen(null); return }
    setOpen(t.id)
    const byId = new Map(t.modules.map(m => [m.moduleId, m]))
    setDraft(Object.fromEntries(data!.modules.map(m => [m.id, byId.get(m.id) ?? { moduleId: m.id, isEnabled: false, seats: 0, priceOverride: null, discountPercent: 0 }])))
  }

  const saveTenant = async (t: TenantRow) => {
    setSaving(true); setMsg('')
    try {
      const res = await fetch(`/api/super-admin/tenants/${t.id}/modules`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modules: Object.values(draft).map(m => ({ moduleId: m.moduleId, isEnabled: m.isEnabled, seats: Math.max(0, Math.round(m.seats || 0)), priceOverride: m.priceOverride, discountPercent: m.discountPercent || 0 })) }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setMsg(json?.error || 'Enregistrement impossible'); return }
      setMsg('Modules enregistrés'); await load()
    } finally { setSaving(false) }
  }

  const saveCatalog = async (id: string) => {
    const m = catalogDraft[id]
    const res = await fetch('/api/super-admin/modules', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, monthlyPrice: m.monthlyPrice, isActive: m.isActive }) })
    const json = await res.json().catch(() => null)
    if (!res.ok) { setError(json?.error || 'Mise à jour du module impossible'); return }
    await load()
  }

  const exportCsv = () => {
    if (!data) return
    const head = ['Entreprise', 'Sous-domaine', 'Statut', 'Utilisateurs', 'Modules', 'Documents 30 j', 'Dernière activité', 'Total HT', 'TVA', 'Total TTC']
    const lines = rows.map(t => [t.name, t.subdomain, STATUS[t.activity.status][0], t.activeUsers, t.invoice.lines.map(l => l.displayName).join(' + '), t.activity.docs30d, t.activity.lastActivity ? new Date(t.activity.lastActivity).toLocaleDateString('fr-TN') : '', t.invoice.totalHT.toFixed(3), t.invoice.tva.toFixed(3), t.invoice.totalTTC.toFixed(3)])
    const csv = [head, ...lines].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `facturation-tenants-${new Date().toISOString().slice(0, 7)}.csv`
    a.click()
  }

  if (error && !data) return <div className="p-6 text-red-400 flex gap-2"><AlertTriangle className="w-5 h-5" />{error}</div>
  if (!data) return <div className="p-6 text-zinc-500">Chargement…</div>
  const s = data.summary
  const card = 'bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5'
  const inp = 'w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-sm text-white'

  return (
    <div className="space-y-6">
      {error && <div className="text-red-400 text-sm">{error}</div>}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div className={card}><TrendingUp className="w-5 h-5 text-emerald-400 mb-2" /><p className="text-xs text-zinc-500">MRR HT</p><p className="text-2xl font-black text-white">{dt(s.mrrHT)} <span className="text-sm text-zinc-500">DT</span></p></div>
        <div className={card}><p className="text-xs text-zinc-500 mt-7">ARR HT estimé</p><p className="text-2xl font-black text-white">{dt(s.mrrHT * 12)}</p></div>
        <div className={card}><Building2 className="w-5 h-5 text-blue-400 mb-2" /><p className="text-xs text-zinc-500">Entreprises actives</p><p className="text-2xl font-black text-white">{s.activeTenants}<span className="text-sm text-zinc-500"> / {s.tenants}</span></p></div>
        <div className={card}><Users className="w-5 h-5 text-purple-400 mb-2" /><p className="text-xs text-zinc-500">Utilisateurs actifs</p><p className="text-2xl font-black text-white">{s.users}</p></div>
        <div className={card}><Activity className="w-5 h-5 text-red-400 mb-2" /><p className="text-xs text-zinc-500">À relancer (dormants)</p><p className="text-2xl font-black text-white">{s.dormant}</p></div>
      </div>

      <div className={card}>
        <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4">Revenu par module</h3>
        <div className="space-y-2">
          {s.byModule.map(m => {
            const pct = s.mrrHT > 0 ? (m.revenueHT / s.mrrHT) * 100 : 0
            return (
              <div key={m.moduleId} className="grid grid-cols-12 items-center gap-3 text-sm">
                <span className="col-span-3 text-zinc-300 truncate">{m.name}</span>
                <div className="col-span-5 h-2 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                <span className="col-span-2 text-zinc-500 text-xs">{m.tenants} ent. · {m.users} util.</span>
                <span className="col-span-2 text-end text-white font-semibold">{dt(m.revenueHT)}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]"><Search className="w-4 h-4 absolute start-3 top-2.5 text-zinc-500" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une entreprise, ville, e-mail…" className="w-full bg-zinc-900 border border-zinc-800 rounded-xl ps-9 pe-3 py-2 text-sm text-white" /></div>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white">
          <option value="all">Tous les statuts</option>{Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white">
          <option value="mrr">Tri : revenu</option><option value="activity">Tri : activité</option><option value="users">Tri : utilisateurs</option><option value="recent">Tri : plus récentes</option>
        </select>
        <button onClick={exportCsv} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white text-zinc-950 text-sm font-bold"><Download className="w-4 h-4" />Export CSV</button>
      </div>

      <div className="space-y-2">
        {rows.map(t => {
          const st = STATUS[t.activity.status]
          return (
            <div key={t.id} className="bg-zinc-900/40 border border-zinc-800 rounded-2xl">
              <button onClick={() => toggleOpen(t)} className="w-full grid grid-cols-12 gap-3 items-center p-4 text-start">
                <div className="col-span-12 md:col-span-3"><p className="font-bold text-white">{t.name}{!t.isActive && <span className="ms-2 text-xs text-red-400">suspendue</span>}</p><p className="text-xs text-zinc-500">{t.subdomain}{t.city ? ` · ${t.city}` : ''}</p></div>
                <div className="col-span-4 md:col-span-2"><span className={`px-2 py-0.5 rounded-full text-xs font-bold ${st[1]}`}>{st[0]}</span><p className="text-xs text-zinc-500 mt-1">{t.activity.idleDays === null ? '—' : t.activity.idleDays === 0 ? "aujourd'hui" : `il y a ${t.activity.idleDays} j`}</p></div>
                <div className="col-span-4 md:col-span-2 text-sm text-zinc-300">{t.activity.docs30d} docs / 30 j<div className="h-1.5 bg-zinc-800 rounded-full mt-1"><div className="h-full bg-blue-500 rounded-full" style={{ width: `${t.activity.score}%` }} /></div></div>
                <div className="col-span-4 md:col-span-1 text-sm text-zinc-300">{t.activeUsers} util.</div>
                <div className="hidden md:block md:col-span-2 text-xs text-zinc-500 truncate">{t.invoice.lines.map(l => l.displayName).join(', ') || 'Aucun module'}</div>
                <div className="col-span-10 md:col-span-1 text-end font-black text-white">{dt(t.invoice.totalHT)}</div>
                <div className="col-span-2 md:col-span-1 flex justify-end text-zinc-500">{open === t.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</div>
              </button>
              {open === t.id && (
                <div className="border-t border-zinc-800 p-4 space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    {[['Factures', t.activity.invoices], ['Tickets POS', t.activity.posOrders], ['Écritures', t.activity.entries], ['Bulletins', t.activity.payslips]].map(([l, v]) => (
                      <div key={l as string} className="bg-zinc-950 rounded-xl p-3"><p className="text-xs text-zinc-500">{l} (30 j)</p><p className="text-lg font-bold text-white">{v}</p></div>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[760px]">
                      <thead className="text-xs text-zinc-500 uppercase"><tr><th className="py-2 text-start">Module</th><th className="text-start">Activé</th><th className="text-start">Sièges (0 = tous)</th><th className="text-start">Prix négocié HT</th><th className="text-start">Remise %</th><th className="text-end">Mensuel HT</th></tr></thead>
                      <tbody>
                        {data.modules.map(m => {
                          const d = draft[m.id]
                          if (!d) return null
                          const c = moduleCharge(m, d, t.activeUsers)
                          return (
                            <tr key={m.id} className="border-t border-zinc-800">
                              <td className="py-2 text-white">{m.icon} {m.displayName}<p className="text-xs text-zinc-500">{dt(m.monthlyPrice)} + {dt(m.pricePerUser)}/util. au-delà de {m.includedUsers}</p></td>
                              <td><input type="checkbox" checked={d.isEnabled} onChange={e => setDraft({ ...draft, [m.id]: { ...d, isEnabled: e.target.checked } })} aria-label={`Activer ${m.displayName}`} /></td>
                              <td className="pe-2"><input type="number" min={0} className={inp} value={d.seats} onChange={e => setDraft({ ...draft, [m.id]: { ...d, seats: Number(e.target.value) } })} /></td>
                              <td className="pe-2"><input type="number" min={0} step="0.001" placeholder="catalogue" className={inp} value={d.priceOverride ?? ''} onChange={e => setDraft({ ...draft, [m.id]: { ...d, priceOverride: e.target.value === '' ? null : Number(e.target.value) } })} /></td>
                              <td className="pe-2"><input type="number" min={0} max={100} className={inp} value={d.discountPercent} onChange={e => setDraft({ ...draft, [m.id]: { ...d, discountPercent: Number(e.target.value) } })} /></td>
                              <td className="text-end text-white">{d.isEnabled ? `${dt(c.total)}` : '—'}{d.isEnabled && c.extraUsers > 0 && <p className="text-xs text-zinc-500">{c.users} util. dont {c.extraUsers} en sus</p>}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-zinc-400">Actuel : {dt(t.invoice.totalHT)} HT · TVA 19 % {dt(t.invoice.tva)} · <span className="text-white font-bold">{dt(t.invoice.totalTTC)} TTC</span> / mois</p>
                    <div className="flex items-center gap-3">{msg && <span className="text-xs text-zinc-400">{msg}</span>}<button disabled={saving} onClick={() => saveTenant(t)} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-zinc-950 text-sm font-bold disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 && <p className="text-zinc-500 text-sm p-4">Aucune entreprise ne correspond.</p>}
      </div>

      <div className={card}>
        <h3 className="text-sm font-black text-white uppercase tracking-widest mb-4">Catalogue et tarifs des modules (HT / mois)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="text-xs text-zinc-500 uppercase"><tr><th className="py-2 text-start">Module</th><th className="text-start">Prix de base</th><th className="text-start">Utilisateurs inclus</th><th className="text-start">Prix / util. en sus</th><th className="text-start">Actif</th><th /></tr></thead>
            <tbody>
              {data.modules.map(m => {
                const d = catalogDraft[m.id] ?? m
                const set = (patch: Partial<CatalogModule>) => setCatalogDraft({ ...catalogDraft, [m.id]: { ...d, ...patch } })
                return (
                  <tr key={m.id} className="border-t border-zinc-800">
                    <td className="py-2 text-white">{m.icon} {m.displayName} <span className="text-xs text-zinc-500">({m.name})</span></td>
                    <td className="pe-2"><input type="number" min={0} step="0.001" className={inp} value={d.monthlyPrice} onChange={e => set({ monthlyPrice: Number(e.target.value) })} /></td>
                    <td className="text-zinc-300">{d.includedUsers}</td>
                    <td className="text-zinc-300">{dt(d.pricePerUser)}</td>
                    <td><input type="checkbox" checked={d.isActive} onChange={e => set({ isActive: e.target.checked })} aria-label={`Module ${m.displayName} actif`} /></td>
                    <td className="text-end"><button onClick={() => saveCatalog(m.id)} className="p-2 rounded-lg text-emerald-400 hover:bg-zinc-800" aria-label={`Enregistrer ${m.displayName}`}><Save className="w-4 h-4" /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
