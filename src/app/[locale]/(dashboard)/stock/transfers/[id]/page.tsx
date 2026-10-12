'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/routing'
import { CheckCircle2, XCircle, Trash2, Pencil, Printer, ArrowRight } from 'lucide-react'
import { StockPage, StockNav, PageHeader, Card, Loading, StatusBadge, Alert, Modal, cls, useStockFormat, api } from '@/components/stock/ui'

type Transfer = {
  id: string; reference: string; date: string; status: string; notes: string | null; validatedAt: string | null; createdAt: string
  fromWarehouse: { id: string; code: string; name: string }; toWarehouse: { id: string; code: string; name: string }
  items: Array<{ id: string; quantity: string; notes: string | null; product: { id: string; code: string; name: string; unit: string } }>
}

export default function TransferDetailPage() {
  const t = useTranslations('StockMod')
  const f = useStockFormat()
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [tr, setTr] = useState<Transfer | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'validate' | 'cancel' | 'delete' | null>(null)

  const load = useCallback(async () => {
    const r = await api<Transfer>(`/api/stock/transfers/${id}`)
    if (r.ok) setTr(r.data); else setError(r.error || t('error_generic'))
  }, [id, t])
  useEffect(() => { load() }, [load])

  async function run(action: 'validate' | 'cancel' | 'delete') {
    setConfirm(null); setBusy(true); setError('')
    const r = action === 'delete'
      ? await api(`/api/stock/transfers/${id}`, { method: 'DELETE' })
      : await api(`/api/stock/transfers/${id}`, { method: 'PATCH', body: JSON.stringify({ action }) })
    setBusy(false)
    if (!r.ok) { setError(r.error || t('error_generic')); return }
    if (action === 'delete') { router.push('/stock/transfers'); return }
    setNotice(action === 'validate' ? t('transfer_validated') : t('transfer_cancelled'))
    load()
  }

  const open = tr && (tr.status === 'DRAFT' || tr.status === 'IN_PROGRESS')

  return (
    <StockPage>
      <PageHeader
        backHref="/stock/transfers"
        title={tr ? `${t('transfer')} ${tr.reference}` : t('transfer')}
        actions={tr && <>
          <button onClick={() => window.print()} className={cls.btnSecondary}><Printer className="w-4 h-4" /> {t('print')}</button>
          {open && <Link href={`/stock/transfers/new?id=${tr.id}`} className={cls.btnSecondary}><Pencil className="w-4 h-4" /> {t('edit')}</Link>}
          {open && <button disabled={busy} onClick={() => setConfirm('cancel')} className={cls.btnSecondary}><XCircle className="w-4 h-4" /> {t('cancel_doc')}</button>}
          {tr.status !== 'TRANSFERRED' && <button disabled={busy} onClick={() => setConfirm('delete')} className={cls.btnSecondary}><Trash2 className="w-4 h-4" /> {t('delete')}</button>}
          {open && <button disabled={busy} onClick={() => setConfirm('validate')} className={cls.btnPrimary}><CheckCircle2 className="w-4 h-4" /> {t('validate')}</button>}
        </>}
      />
      <StockNav />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert tone="green" onClose={() => setNotice('')}>{notice}</Alert>}
      {!tr ? (error ? null : <Loading />) : (
        <div className="space-y-6">
          <Card>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div><dt className="text-xs text-zinc-500">{t('status')}</dt><dd className="mt-1"><StatusBadge status={tr.status} /></dd></div>
              <div><dt className="text-xs text-zinc-500">{t('date')}</dt><dd className="mt-1 font-medium">{f.date(tr.date)}</dd></div>
              <div className="col-span-2"><dt className="text-xs text-zinc-500">{t('route')}</dt>
                <dd className="mt-1 font-medium flex items-center gap-2">
                  <Link href={`/stock/availability/${tr.fromWarehouse.id}`} className="hover:text-teal-700">{tr.fromWarehouse.name}</Link>
                  <ArrowRight className="w-4 h-4 text-zinc-400 rtl:rotate-180" />
                  <Link href={`/stock/availability/${tr.toWarehouse.id}`} className="hover:text-teal-700">{tr.toWarehouse.name}</Link>
                </dd>
              </div>
              {tr.validatedAt && <div><dt className="text-xs text-zinc-500">{t('validated_at')}</dt><dd className="mt-1">{f.dateTime(tr.validatedAt)}</dd></div>}
              {tr.notes && <div className="col-span-2 md:col-span-3"><dt className="text-xs text-zinc-500">{t('notes')}</dt><dd className="mt-1">{tr.notes}</dd></div>}
            </dl>
          </Card>
          <Card title={t('lines')} bodyClassName="p-0">
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <table className={cls.table}>
              <thead className="bg-zinc-50"><tr>
                <th className={cls.th}>{t('code')}</th>
                <th className={cls.th}>{t('product')}</th>
                <th className={`${cls.th} text-end`}>{t('quantity')}</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {tr.items.map(i => (
                  <tr key={i.id}>
                    <td className={`${cls.td} font-mono text-xs`}>{i.product.code}</td>
                    <td className={cls.td}><Link href={`/stock/products/${i.product.id}`} className="hover:text-teal-700">{i.product.name}</Link></td>
                    <td className={cls.tdNum}>{f.qty(i.quantity)} <span className="text-xs text-zinc-400">{i.product.unit}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
          {tr.status === 'TRANSFERRED' && (
            <p className="no-print text-sm text-zinc-500 text-start">
              <Link href={`/stock/movements?type=TRANSFER`} className="text-teal-700 hover:underline">{t('see_generated_movements')}</Link>
            </p>
          )}
        </div>
      )}

      <Modal open={!!confirm} title={confirm ? t(`confirm_${confirm}_title`) : ''} onClose={() => setConfirm(null)}
        footer={<>
          <button onClick={() => setConfirm(null)} className={cls.btnSecondary}>{t('back')}</button>
          <button onClick={() => confirm && run(confirm)} className={confirm === 'validate' ? cls.btnPrimary : cls.btnDanger}>{t('confirm')}</button>
        </>}>
        <p className="text-sm text-zinc-600 text-start">{confirm ? t(`confirm_transfer_${confirm}`) : ''}</p>
      </Modal>
    </StockPage>
  )
}
