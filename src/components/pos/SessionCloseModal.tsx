'use client'

/**
 * Fermeture de caisse : affiche les espèces attendues (fond + espèces encaissées − monnaie rendue),
 * saisie du montant compté, écart en direct, puis ouverture du rapport Z imprimable.
 */
import { useEffect, useState } from 'react'
import { useRouter } from '@/i18n/routing'
import { apiFormError, fetchJson } from '@/lib/form-errors'
import { round3, type ZReport } from '@/lib/pos-logic'

const fmt = (n: number) => `${n.toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} DT`

export default function SessionCloseModal({ sessionId, onClosed, onClose }: { sessionId: string; onClosed: () => void; onClose: () => void }) {
  const router = useRouter()
  const [report, setReport] = useState<ZReport | null>(null)
  const [counted, setCounted] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchJson<{ report: ZReport }>(`/api/pos/sessions/${sessionId}/z`).then(r => {
      if (r.ok && r.data) { setReport(r.data.report); setCounted(String(r.data.report.expectedCash)) }
      else setError(apiFormError(r.status, r.data).message)
    })
  }, [sessionId])

  const countedNum = counted === '' ? NaN : Number(counted)
  const diff = report && Number.isFinite(countedNum) ? round3(countedNum - report.expectedCash) : null

  const confirm = async () => {
    if (!Number.isFinite(countedNum) || countedNum < 0) { setError('Saisissez le montant d’espèces compté (nombre positif).'); return }
    setSaving(true); setError('')
    const r = await fetchJson(`/api/pos/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ countedCash: countedNum, notes: notes || undefined }) })
    setSaving(false)
    if (!r.ok) { setError(apiFormError(r.status, r.data, { countedCash: 'Espèces comptées' }).message); return }
    onClosed()
    router.push(`/pos/z/${sessionId}`)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-stone-100 bg-stone-50">
          <h3 className="font-black text-stone-900 text-lg">Fermer la caisse</h3>
          <p className="text-xs text-stone-500 mt-1">Comptez les espèces du tiroir puis validez : le rapport Z sera généré.</p>
        </div>
        <div className="p-6 space-y-4">
          {error && <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-bold">{error}</div>}
          {!report ? <p className="text-sm text-stone-500">{error ? '' : 'Calcul en cours…'}</p> : (
            <div className="text-sm space-y-1.5">
              <div className="flex justify-between"><span className="text-stone-500">Tickets</span><span className="font-bold">{report.ordersCount}</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Chiffre d’affaires TTC</span><span className="font-bold">{fmt(report.totalTTC)}</span></div>
              <div className="flex justify-between"><span className="text-stone-500">Fond de caisse</span><span className="font-bold">{fmt(report.openingCash)}</span></div>
              <div className="flex justify-between"><span className="text-stone-500">+ Espèces encaissées</span><span className="font-bold">{fmt(report.cashIn)}</span></div>
              {report.changeGiven > 0 && <div className="flex justify-between"><span className="text-stone-500">− Monnaie rendue</span><span className="font-bold">{fmt(report.changeGiven)}</span></div>}
              <div className="flex justify-between border-t border-stone-200 pt-2"><span className="font-black">Espèces attendues</span><span className="font-black text-teal-700">{fmt(report.expectedCash)}</span></div>
            </div>
          )}
          <label className="block">
            <span className="text-xs font-black text-stone-500 uppercase tracking-widest">Espèces comptées</span>
            <input type="number" step="0.001" min="0" value={counted} onChange={e => setCounted(e.target.value)} className="mt-1 w-full px-4 py-3 border-2 border-stone-200 rounded-xl text-xl font-black text-end focus:border-teal-500 focus:outline-none font-mono" />
          </label>
          {diff !== null && <p className={`text-sm font-bold ${diff === 0 ? 'text-emerald-600' : 'text-amber-600'}`}>Écart : {diff > 0 ? '+' : ''}{fmt(diff)}</p>}
          <textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={1000} placeholder="Note de clôture (facultatif)" className="w-full px-3 py-2 border border-stone-200 rounded-xl text-sm" rows={2} />
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 border-2 border-stone-200 rounded-xl font-bold text-stone-600 hover:bg-stone-50">Annuler</button>
            <button onClick={confirm} disabled={saving || !report} className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl font-bold">{saving ? '…' : 'Fermer et éditer le Z'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
