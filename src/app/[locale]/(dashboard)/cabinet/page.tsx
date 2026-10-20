'use client'

/**
 * Espace cabinet comptable : dossiers clients triés par urgence (échéance de la déclaration mensuelle,
 * certificats RS incomplets, pièces scannées à traiter), ouverture d'un dossier, exports CSV pour le logiciel du cabinet.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/i18n/routing'
import { Briefcase, Download, FolderOpen, Plus, KeyRound, ArrowLeft } from 'lucide-react'
import { StockPage, PageHeader, Card, Alert, cls, useStockFormat } from '@/components/stock/ui'

type Alert = { code: string; level: 'info' | 'warning' | 'danger'; value?: number }
type Figures = { salesHT: number; vatNet: number; rsAmount: number; rsCount: number }
type Client = {
  tenantId: string; name: string; matriculeFiscal: string | null; period: { year: number; month: number }
  previous: Figures; current: Figures; scansToReview: number; deadline: string; daysLeft: number; alerts: Alert[]
}
type FirmData = { firm: { id: string; name: string } | null; role?: string; activeTenantId?: string | null; clients: Client[] }

const levelCls: Record<Alert['level'], string> = {
  danger: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  info: 'bg-sky-50 text-sky-700 border-sky-200',
}

export default function FirmPage() {
  const t = useTranslations('Firm')
  const f = useStockFormat()
  const router = useRouter()
  const [data, setData] = useState<FirmData | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [firmForm, setFirmForm] = useState({ name: '', matriculeFiscal: '', email: '', phone: '' })
  const [code, setCode] = useState('')
  const [client, setClient] = useState({ companyName: '', matriculeFiscal: '', city: '', email: '' })

  const load = useCallback(async () => {
    const r = await fetch('/api/firm', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j.error || t('error')); return }
    setData(j)
  }, [t])
  useEffect(() => { load() }, [load])

  async function post(url: string, body: unknown, ok?: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(j.error || t('error')); return null }
      if (ok) setNotice(ok)
      return j
    } finally { setBusy(false) }
  }

  async function openClient(tenantId: string | null) {
    const j = await post('/api/firm/switch', { tenantId })
    if (j) { router.push('/dashboard'); router.refresh() }
  }

  const exportUrl = (c: Client, kind: 'register' | 'journal') =>
    `/api/firm/clients/${c.tenantId}/export?year=${c.period.year}&month=${c.period.month}&kind=${kind}`

  if (!data) return <StockPage><PageHeader title={t('title')} /></StockPage>

  if (!data.firm) {
    return (
      <StockPage>
        <PageHeader title={t('title')} description={t('desc')} />
        {error && <Alert onClose={() => setError('')}>{error}</Alert>}
        <div className="max-w-xl">
          <Card title={t('create_title')}>
            <p className="text-sm text-zinc-600 mb-4 text-start">{t('create_desc')}</p>
            <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await post('/api/firm', firmForm)) load() }}>
              <div><label className={cls.label}>{t('firm_name')}</label><input className={cls.input} required minLength={2} value={firmForm.name} onChange={e => setFirmForm({ ...firmForm, name: e.target.value })} /></div>
              <div><label className={cls.label}>{t('mf')}</label><input className={cls.input} value={firmForm.matriculeFiscal} onChange={e => setFirmForm({ ...firmForm, matriculeFiscal: e.target.value })} placeholder="1234567A/A/M/000" /></div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className={cls.label}>{t('email')}</label><input type="email" className={cls.input} value={firmForm.email} onChange={e => setFirmForm({ ...firmForm, email: e.target.value })} /></div>
                <div><label className={cls.label}>{t('phone')}</label><input className={cls.input} value={firmForm.phone} onChange={e => setFirmForm({ ...firmForm, phone: e.target.value })} /></div>
              </div>
              <button className={cls.btnPrimary} disabled={busy}><Briefcase className="w-4 h-4" /> {t('create')}</button>
            </form>
          </Card>
          <p className="mt-4 text-sm text-start"><Link href="/cabinet/acces" className="text-teal-700 font-semibold hover:underline">{t('manage_access')}</Link></p>
        </div>
      </StockPage>
    )
  }

  return (
    <StockPage>
      <PageHeader title={`${t('title')} — ${data.firm.name}`} description={t('desc')}
        actions={data.activeTenantId ? <button className={cls.btnSecondary} onClick={() => openClient(null)}><ArrowLeft className="w-4 h-4" /> {t('back_to_firm')}</button> : undefined} />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert tone="green" onClose={() => setNotice('')}>{notice}</Alert>}

      <Card title={t('clients')} bodyClassName="p-0">
        {data.clients.length === 0 ? <p className="p-5 text-sm text-zinc-500 text-start">{t('no_clients')}</p> : (
          <div className="overflow-x-auto">
            <table className={cls.table}>
              <thead className="bg-zinc-50 border-b border-zinc-200"><tr>
                <th className={cls.th}>{t('col_client')}</th><th className={cls.th}>{t('col_deadline')}</th>
                <th className={cls.th + ' text-end'}>{t('col_sales')}</th><th className={cls.th + ' text-end'}>{t('col_vat')}</th>
                <th className={cls.th + ' text-end'}>{t('col_rs')}</th><th className={cls.th + ' text-end'}>{t('col_scans')}</th>
                <th className={cls.th}>{t('col_actions')}</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {data.clients.map(c => (
                  <tr key={c.tenantId} className={c.tenantId === data.activeTenantId ? 'bg-teal-50/50' : ''}>
                    <td className={cls.td}>
                      <div className="font-semibold text-zinc-900">{c.name}</div>
                      {c.matriculeFiscal && <div className="font-mono text-xs text-zinc-500">{c.matriculeFiscal}</div>}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.alerts.map(a => <span key={a.code} className={`text-[11px] px-2 py-0.5 rounded-full border ${levelCls[a.level]}`}>{t(`alert_${a.code}` as 'alert_NO_MF', { n: a.value ?? 0 })}</span>)}
                      </div>
                    </td>
                    <td className={cls.td + ' whitespace-nowrap'}>
                      <div>{f.date(c.deadline)}</div>
                      <div className={`text-xs ${c.daysLeft < 0 ? 'text-red-600' : c.daysLeft <= 3 ? 'text-amber-700' : 'text-zinc-500'}`}>{c.daysLeft < 0 ? t('days_late', { n: -c.daysLeft }) : t('days_left', { n: c.daysLeft })}</div>
                      <div className="text-xs text-zinc-400">{t('period', { month: c.period.month, year: c.period.year })}</div>
                    </td>
                    <td className={cls.tdNum}>{f.money(c.previous.salesHT)}</td>
                    <td className={cls.tdNum}>{f.money(c.previous.vatNet)}</td>
                    <td className={cls.tdNum}>{f.money(c.previous.rsAmount)}</td>
                    <td className={cls.tdNum}>{c.scansToReview}</td>
                    <td className={cls.td}>
                      <div className="flex flex-wrap gap-1">
                        <button className={cls.btnGhost} onClick={() => openClient(c.tenantId)}><FolderOpen className="w-4 h-4" /> {t('open')}</button>
                        <a className={cls.btnGhost} href={exportUrl(c, 'register')}><Download className="w-4 h-4" /> {t('export_register')}</a>
                        <a className={cls.btnGhost} href={exportUrl(c, 'journal')}><Download className="w-4 h-4" /> {t('export_journal')}</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-5 py-3 text-xs text-zinc-500 border-t border-zinc-100 text-start">{t('deadline_note')} · <Link href="/cabinet/acces" className="text-teal-700 hover:underline">{t('manage_access')}</Link></p>
      </Card>

      <div className="grid md:grid-cols-2 gap-6 mt-6">
        <Card title={t('join_title')}>
          <p className="text-sm text-zinc-600 mb-3 text-start">{t('join_desc')}</p>
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await post('/api/firm/join', { code }, t('added'))) { setCode(''); load() } }}>
            <input className={cls.input + ' font-mono uppercase'} required value={code} onChange={e => setCode(e.target.value)} placeholder="ABCD-EFGH" aria-label={t('code')} />
            <button className={cls.btnPrimary} disabled={busy}><KeyRound className="w-4 h-4" /> {t('join')}</button>
          </form>
        </Card>
        <Card title={t('new_client_title')}>
          <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); if (await post('/api/firm/clients', client, t('added'))) { setClient({ companyName: '', matriculeFiscal: '', city: '', email: '' }); load() } }}>
            <div><label className={cls.label}>{t('company')}</label><input className={cls.input} required value={client.companyName} onChange={e => setClient({ ...client, companyName: e.target.value })} /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className={cls.label}>{t('mf')}</label><input className={cls.input} value={client.matriculeFiscal} onChange={e => setClient({ ...client, matriculeFiscal: e.target.value })} placeholder="1234567A/A/M/000" /></div>
              <div><label className={cls.label}>{t('city')}</label><input className={cls.input} value={client.city} onChange={e => setClient({ ...client, city: e.target.value })} /></div>
            </div>
            <div><label className={cls.label}>{t('email')}</label><input type="email" className={cls.input} value={client.email} onChange={e => setClient({ ...client, email: e.target.value })} /></div>
            <button className={cls.btnPrimary} disabled={busy}><Plus className="w-4 h-4" /> {t('open_new')}</button>
          </form>
        </Card>
      </div>
    </StockPage>
  )
}
