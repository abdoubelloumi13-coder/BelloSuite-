'use client'

/** Côté entreprise : code d'invitation pour son cabinet comptable, liste des accès, révocation immédiate. */
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { KeyRound, ShieldOff } from 'lucide-react'
import { StockPage, PageHeader, Card, Alert, cls, useStockFormat } from '@/components/stock/ui'

type Access = { firmId: string; status: string; origin: string; createdAt: string; revokedAt: string | null; firm: { name: string; matriculeFiscal: string | null; email: string | null } }

export default function FirmAccessPage() {
  const t = useTranslations('Firm')
  const f = useStockFormat()
  const [list, setList] = useState<Access[]>([])
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const r = await fetch('/api/tenant/firm-access', { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setError(j.error || t('error')); return }
    setList(j.accesses)
  }, [t])
  useEffect(() => { load() }, [load])

  async function generate() {
    setBusy(true); setError('')
    const r = await fetch('/api/tenant/firm-access', { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setError(j.error || t('error')); return }
    setCode(j)
  }

  async function revoke(firmId: string) {
    setBusy(true); setError('')
    const r = await fetch(`/api/tenant/firm-access?firmId=${encodeURIComponent(firmId)}`, { method: 'DELETE' })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) { setError(j.error || t('error')); return }
    load()
  }

  return (
    <StockPage>
      <PageHeader title={t('access_title')} description={t('access_desc')} />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="max-w-2xl grid gap-6">
        <Card title={t('generate_code')}>
          {code ? (
            <div className="text-start">
              <div className="font-mono text-3xl font-bold tracking-widest text-teal-700">{code.code}</div>
              <p className="mt-2 text-sm text-zinc-600">{t('code_once')}</p>
              <p className="text-xs text-zinc-500">{t('expires', { date: f.date(code.expiresAt) })}</p>
            </div>
          ) : (
            <button className={cls.btnPrimary} onClick={generate} disabled={busy}><KeyRound className="w-4 h-4" /> {t('generate_code')}</button>
          )}
        </Card>
        <Card title={t('clients')} bodyClassName="p-0">
          {list.length === 0 ? <p className="p-5 text-sm text-zinc-500 text-start">{t('no_access')}</p> : (
            <ul className="divide-y divide-zinc-100">
              {list.map(a => (
                <li key={a.firmId} className="p-4 flex items-center justify-between gap-3">
                  <div className="text-start">
                    <div className="font-semibold text-zinc-900">{a.firm.name}</div>
                    <div className="text-xs text-zinc-500">{t(`origin_${a.origin}` as 'origin_INVITE')} · {f.date(a.createdAt)} · {t(`status_${a.status}` as 'status_ACTIVE')}</div>
                  </div>
                  {a.status === 'ACTIVE' && <button className={cls.btnSecondary} onClick={() => revoke(a.firmId)} disabled={busy}><ShieldOff className="w-4 h-4" /> {t('revoke')}</button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </StockPage>
  )
}
