'use client'
import { useState, useEffect } from 'react'
import { Globe, FileText, Download, Plus, Ship, Plane, Truck, Package } from 'lucide-react'
import { useSession } from '@/hooks/useSession'
import { useTranslations, useLocale } from 'next-intl'

const INCOTERMS = ['EXW', 'FOB', 'CIF', 'DDP', 'CFR', 'FAS', 'CPT', 'CIP']
const TRANSPORT_MODES = [
  { code: 'MARITIME', label: 'Maritime', icon: Ship },
  { code: 'AIR', label: 'Aerien', icon: Plane },
  { code: 'ROAD', label: 'Route', icon: Truck },
  { code: 'RAIL', label: 'Rail', icon: Package },
]

export default function ExportPage() {
  const te = useTranslations('Commercial.Export')
  const locale = useLocale()
  const { tenantId } = useSession()
  const [exports, setExports] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [invoices, setInvoices] = useState<any[]>([])
  const [form, setForm] = useState({
    invoiceId: '',
    countryDest: '',
    incoterm: 'EXW',
    hsCode: '',
    netWeightKg: '',
    countryOrigin: 'TN',
    exportRegime: 'Definitif',
    customsPort: '',
    transportMode: 'MARITIME',
  })

  const fetchData = async (tid: string) => {
    setLoading(true)
    try {
      const [expRes, invRes] = await Promise.all([
        fetch('/api/commercial/export'),
        fetch('/api/commercial/invoices'),
      ])
      if (expRes.ok) setExports(await expRes.json())
      if (invRes.ok) setInvoices(await invRes.json())
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const res = await fetch('/api/commercial/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, tenantId }),
    })
    if (res.ok) { fetchData(tenantId); setShowForm(false) }
  }

  const filtered = exports.filter((ex: any) =>
    !search || ex.invoice?.number?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-stone-900 tracking-tight flex items-center gap-3">
            <Globe className="w-8 h-8 text-teal-600" /> {te('title')}
          </h1>
          <p className="text-stone-500 mt-1 text-sm font-medium">{te('subtitle')}</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-5 py-3 bg-teal-600 text-white rounded-xl font-bold text-sm shadow-lg hover:bg-teal-500 transition-all"
        >
          <Plus className="w-5 h-5" /> {te('new')}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-stone-200 p-8 space-y-5 shadow-sm">
          <h2 className="font-black text-lg text-stone-800">{te('form_title')}</h2>
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-1">
              <label className="text-xs font-black text-stone-500 uppercase tracking-widest">{te('linked_invoice')}</label>
              <select
                required
                value={form.invoiceId}
                onChange={(e) => setForm({ ...form, invoiceId: e.target.value })}
                className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-teal-500"
              >
                <option value="">{te('select')}</option>
                {invoices.map((inv: any) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.number} - {inv.client?.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black text-stone-500 uppercase tracking-widest">{te('country_dest')}</label>
              <input
                required
                value={form.countryDest}
                onChange={(e) => setForm({ ...form, countryDest: e.target.value })}
                className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-teal-500"
                placeholder={te('country_placeholder')}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black text-stone-500 uppercase tracking-widest">{te('incoterm')}</label>
              <select
                value={form.incoterm}
                onChange={(e) => setForm({ ...form, incoterm: e.target.value })}
                className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-teal-500"
              >
                {INCOTERMS.map((i) => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black text-stone-500 uppercase tracking-widest">{te('hs_code')}</label>
              <input
                value={form.hsCode}
                onChange={(e) => setForm({ ...form, hsCode: e.target.value })}
                className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-teal-500"
                placeholder={te('hs_placeholder')}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black text-stone-500 uppercase tracking-widest">{te('transport_mode')}</label>
              <select
                value={form.transportMode}
                onChange={(e) => setForm({ ...form, transportMode: e.target.value })}
                className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-teal-500"
              >
                {TRANSPORT_MODES.map((m) => (
                  <option key={m.code} value={m.code}>{te(`transport.${m.code}`)}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black text-stone-500 uppercase tracking-widest">{te('customs_regime')}</label>
              <select
                value={form.exportRegime}
                onChange={(e) => setForm({ ...form, exportRegime: e.target.value })}
                className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-teal-500"
              >
                <option value="Definitif">{te('regime.definitif')}</option>
                <option value="Temporaire">{te('regime.temporaire')}</option>
                <option value="Admission temporaire">{te('regime.admission')}</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black text-stone-500 uppercase tracking-widest">{te('customs_port')}</label>
              <input
                value={form.customsPort}
                onChange={(e) => setForm({ ...form, customsPort: e.target.value })}
                className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-teal-500"
                placeholder={te('port_placeholder')}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-black text-stone-500 uppercase tracking-widest">{te('net_weight')}</label>
              <input
                type="number"
                step="0.01"
                value={form.netWeightKg}
                onChange={(e) => setForm({ ...form, netWeightKg: e.target.value })}
                className="w-full border border-stone-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-teal-500"
              />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="px-6 py-2.5 bg-teal-600 text-white rounded-xl font-bold text-sm hover:bg-teal-500 transition-all"
            >
              {te('save')}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-6 py-2.5 border border-stone-200 text-stone-600 rounded-xl font-bold text-sm hover:bg-stone-50"
            >
              {te('cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <table className="w-full text-start">
            <thead>
              <tr className="bg-stone-50 text-[10px] font-black text-stone-500 uppercase tracking-widest">
                <th className="px-6 py-4">{te('col_invoice')}</th>
                <th className="px-6 py-4">{te('col_client')}</th>
                <th className="px-6 py-4">{te('col_destination')}</th>
                <th className="px-6 py-4">{te('incoterm')}</th>
                <th className="px-6 py-4">{te('col_regime')}</th>
                <th className="px-6 py-4">{te('col_transport')}</th>
                <th className="px-6 py-4 text-end">{te('col_amount')}</th>
                <th className="px-6 py-4 text-end">{te('col_actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-stone-400 font-bold text-sm">
                    {te('loading')}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-stone-400 font-bold text-sm">
                    {te('empty')}
                  </td>
                </tr>
              ) : (
                filtered.map((ex: any) => {
                  const ModeIcon = TRANSPORT_MODES.find((t) => t.code === ex.transportMode)?.icon || Plane
                  return (
                    <tr key={ex.id} className="hover:bg-stone-50/60 transition-colors">
                      <td className="px-6 py-4"><span className="font-mono font-bold text-stone-800 text-sm">{ex.invoice?.number}</span></td>
                      <td className="px-6 py-4 text-sm text-stone-600">{ex.invoice?.client?.name}</td>
                      <td className="px-6 py-4 text-sm text-stone-600">{ex.countryDest}</td>
                      <td className="px-6 py-4"><span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-xs font-black">{ex.incoterm}</span></td>
                      <td className="px-6 py-4 text-sm text-stone-500">
                        {({
                          Definitif: te('regime.definitif'),
                          Temporaire: te('regime.temporaire'),
                          'Admission temporaire': te('regime.admission'),
                        } as Record<string, string>)[ex.exportRegime] ?? ex.exportRegime}
                      </td>
                      <td className="px-6 py-4"><ModeIcon className="w-4 h-4 text-stone-400" /></td>
                      <td className="px-6 py-4 text-end font-mono font-bold text-stone-700">
                        {Number(ex.invoice?.totalTTC || 0).toLocaleString(`${locale}-TN`, { maximumFractionDigits: 3 })} DT
                      </td>
                      <td className="px-6 py-4 text-end">
                        <a
                          href={"/api/commercial/export/" + ex.id + "/ci5"}
                          target="_blank"
                          className="p-2 bg-stone-100 hover:bg-teal-50 text-stone-500 hover:text-teal-600 rounded-lg transition-all inline-flex"
                          title={te('ci5_form')}
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}