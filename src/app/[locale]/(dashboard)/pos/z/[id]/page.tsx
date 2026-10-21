'use client'

/** Rapport Z (session fermée) / X (session ouverte) — écran imprimable (format ticket 80 mm à l'impression). */
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Link } from '@/i18n/routing'
import { Printer, ArrowLeft } from 'lucide-react'
import { apiFormError, fetchJson } from '@/lib/form-errors'
import type { ZReport } from '@/lib/pos-logic'

type ZResponse = {
  session: { id: string; userName: string; status: string; openedAt: string; closedAt: string | null; notes: string | null }
  tenant: { name: string; matriculeFiscal: string | null; address: string | null; city: string | null } | null
  firstTicket: string | null
  lastTicket: string | null
  report: ZReport
}

const METHODS: Record<string, string> = { CASH: 'Espèces', CARD: 'Carte', CHECK: 'Chèque', BANK_TRANSFER: 'Virement', MIXED: 'Mixte' }
const n3 = (n: number) => n.toLocaleString('fr-TN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('fr-TN') : '—')

export default function ZReportPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ZResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchJson<ZResponse>(`/api/pos/sessions/${id}/z`).then(r => {
      if (r.ok && r.data) setData(r.data)
      else setError(apiFormError(r.status, r.data).message)
    })
  }, [id])

  const Row = ({ l, v, b }: { l: string; v: string; b?: boolean }) => (
    <div className={`flex justify-between gap-4 ${b ? 'font-black' : ''}`}><span>{l}</span><span className="tabular-nums">{v}</span></div>
  )

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <style>{`@media print { @page { size: 80mm auto; margin: 4mm } body * { visibility: hidden } #z-report, #z-report * { visibility: visible } #z-report { position: absolute; inset: 0; width: 72mm; border: 0 !important; box-shadow: none !important } }`}</style>
      <div className="flex items-center justify-between print:hidden">
        <Link href="/pos" className="flex items-center gap-1 text-sm font-bold text-stone-500 hover:text-teal-600"><ArrowLeft className="w-4 h-4" /> Caisse</Link>
        <button onClick={() => window.print()} disabled={!data} className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl font-bold text-sm"><Printer className="w-4 h-4" /> Imprimer</button>
      </div>
      {error && <div role="alert" className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm font-bold">{error}</div>}
      {!data && !error && <p className="text-sm text-stone-500">Chargement…</p>}
      {data && (() => {
        const r = data.report
        const closed = data.session.status === 'CLOSED'
        return (
          <div id="z-report" className="bg-white border border-stone-200 rounded-xl p-4 font-mono text-xs space-y-3 shadow-sm">
            <div className="text-center space-y-0.5">
              <div className="font-black text-sm">{data.tenant?.name || 'BELLO SUITE'}</div>
              {data.tenant?.matriculeFiscal && <div>MF : {data.tenant.matriculeFiscal}</div>}
              {(data.tenant?.address || data.tenant?.city) && <div>{[data.tenant?.address, data.tenant?.city].filter(Boolean).join(', ')}</div>}
              <div className="font-black text-sm pt-1">{closed ? 'RAPPORT Z — CLÔTURE' : 'RAPPORT X — PROVISOIRE (caisse ouverte)'}</div>
              <div>Session {data.session.id.slice(-6).toUpperCase()} — {data.session.userName}</div>
              <div>Ouverture : {dt(data.session.openedAt)}</div>
              <div>Clôture : {dt(data.session.closedAt)}</div>
            </div>
            <div className="border-t border-dashed border-stone-400 pt-2 space-y-0.5">
              <Row l="Tickets" v={String(r.ordersCount)} />
              {r.cancelledCount > 0 && <Row l="Tickets annulés" v={String(r.cancelledCount)} />}
              {data.firstTicket && <Row l="Du ticket" v={data.firstTicket} />}
              {data.lastTicket && <Row l="Au ticket" v={data.lastTicket} />}
              <Row l="Ticket moyen" v={n3(r.averageTicket)} />
            </div>
            <div className="border-t border-dashed border-stone-400 pt-2 space-y-0.5">
              {r.totalDiscount > 0 && <Row l="Remises accordées" v={`-${n3(r.totalDiscount)}`} />}
              <Row l="Total HT" v={n3(r.totalHT)} />
              {r.vatByRate.map(v => <Row key={v.rate} l={`TVA ${v.rate} % (base ${n3(v.base)})`} v={n3(v.vat)} />)}
              <Row l="Total TVA" v={n3(r.totalVAT)} />
              {r.totalStamp > 0 && <Row l="Timbres fiscaux" v={n3(r.totalStamp)} />}
              <Row l="TOTAL TTC" v={`${n3(r.totalTTC)} DT`} b />
            </div>
            <div className="border-t border-dashed border-stone-400 pt-2 space-y-0.5">
              <div className="font-black">Encaissements</div>
              {r.byMethod.length === 0 && <div>Aucun</div>}
              {r.byMethod.map(m => <Row key={m.method} l={METHODS[m.method] || m.method} v={n3(m.amount)} />)}
              {r.changeGiven > 0 && <Row l="Monnaie rendue" v={`-${n3(r.changeGiven)}`} />}
            </div>
            <div className="border-t border-dashed border-stone-400 pt-2 space-y-0.5">
              <div className="font-black">Tiroir-caisse</div>
              <Row l="Fond de caisse" v={n3(r.openingCash)} />
              <Row l="Espèces nettes" v={n3(r.cashIn - r.changeGiven)} />
              <Row l="Espèces attendues" v={n3(r.expectedCash)} b />
              {r.countedCash !== null && <Row l="Espèces comptées" v={n3(r.countedCash)} />}
              {r.cashDifference !== null && <Row l="Écart" v={`${r.cashDifference > 0 ? '+' : ''}${n3(r.cashDifference)}`} b />}
            </div>
            {data.session.notes && <div className="border-t border-dashed border-stone-400 pt-2">Note : {data.session.notes}</div>}
            <div className="text-center border-t border-dashed border-stone-400 pt-2">Édité le {new Date().toLocaleString('fr-TN')}</div>
          </div>
        )
      })()}
    </div>
  )
}
