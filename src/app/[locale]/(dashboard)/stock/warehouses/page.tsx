'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import { Plus, Pencil, Archive, ArchiveRestore, Trash2, Star, Eye } from 'lucide-react'
import { StockPage, StockNav, PageHeader, Card, Loading, EmptyState, Badge, Alert, Modal, Field, cls, useStockFormat, api } from '@/components/stock/ui'
import { apiFormError } from '@/lib/form-errors'

type Warehouse = {
  id: string; code: string; name: string; address: string | null; manager: string | null; phone: string | null
  isDefault: boolean; isActive: boolean; totalProducts: number; totalQty: number; totalValue: number; lowStockCount: number
}
const EMPTY = { code: '', name: '', address: '', manager: '', phone: '', isDefault: false }

export default function WarehousesPage() {
  const t = useTranslations('StockMod')
  const f = useStockFormat()
  const [rows, setRows] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<Warehouse | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  // Erreurs affichées DANS la modale (avant : bannière de page masquée derrière la modale → échec « muet »)
  const [formError, setFormError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [confirmDelete, setConfirmDelete] = useState<Warehouse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await api<Warehouse[]>(`/api/stock/warehouses?includeArchived=${showArchived ? 1 : 0}`)
    if (r.ok) setRows(r.data); else { setRows([]); setError(r.error || t('error_generic')) }
    setLoading(false)
  }, [showArchived, t])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (new URLSearchParams(window.location.search).get('new')) openCreate() }, [])

  function openCreate() { setEditing(null); setForm(EMPTY); setFormError(''); setFieldErrors({}); setOpen(true) }
  function openEdit(w: Warehouse) {
    setEditing(w)
    setFormError(''); setFieldErrors({})
    setForm({ code: w.code, name: w.name, address: w.address ?? '', manager: w.manager ?? '', phone: w.phone ?? '', isDefault: w.isDefault })
    setOpen(true)
  }

  async function save() {
    const missing: Record<string, string> = {}
    if (!form.code.trim()) missing.code = 'Champ obligatoire'
    if (!form.name.trim()) missing.name = 'Champ obligatoire'
    if (Object.keys(missing).length) { setFieldErrors(missing); setFormError(t('required_fields')); return }
    setSaving(true); setFormError(''); setFieldErrors({})
    const r = editing
      ? await api(`/api/stock/warehouses/${editing.id}`, { method: 'PUT', body: JSON.stringify(form) })
      : await api('/api/stock/warehouses', { method: 'POST', body: JSON.stringify(form) })
    setSaving(false)
    if (!r.ok) {
      const fe = apiFormError(r.status, r.data, { code: t('code'), name: t('name'), address: t('address'), manager: t('manager'), phone: t('phone') })
      setFormError(fe.message); setFieldErrors(fe.fields); return
    }
    setOpen(false); setNotice(t('saved')); load()
  }

  async function patch(w: Warehouse, data: Record<string, unknown>) {
    const r = await api(`/api/stock/warehouses/${w.id}`, { method: 'PUT', body: JSON.stringify(data) })
    if (!r.ok) setError(r.error || t('error_generic')); else { setNotice(t('saved')); load() }
  }

  async function remove(w: Warehouse) {
    setConfirmDelete(null)
    const r = await api(`/api/stock/warehouses/${w.id}`, { method: 'DELETE' })
    if (r.ok) { setNotice(t('deleted')); load(); return }
    if (r.error === 'WAREHOUSE_HAS_STOCK') setError(t('warehouse_has_stock'))
    else if (r.error === 'WAREHOUSE_HAS_HISTORY') setError(t('warehouse_has_history'))
    else setError(r.error || t('error_generic'))
  }

  return (
    <StockPage>
      <PageHeader
        title={t('warehouses_title')}
        description={t('warehouses_desc')}
        actions={<button onClick={openCreate} className={cls.btnPrimary}><Plus className="w-4 h-4" /> {t('new_warehouse')}</button>}
      />
      <StockNav />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert tone="green" onClose={() => setNotice('')}>{notice}</Alert>}

      <Card
        title={t('warehouse_list')}
        actions={<label className="flex items-center gap-2 text-sm text-zinc-600"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} className="accent-teal-600" /> {t('show_archived')}</label>}
        bodyClassName="p-0"
      >
        {loading ? <Loading /> : rows.length === 0 ? (
          <EmptyState title={t('no_warehouse')} action={<button onClick={openCreate} className={cls.btnPrimary}><Plus className="w-4 h-4" /> {t('create_warehouse')}</button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className={cls.table}>
              <thead className="bg-zinc-50"><tr>
                <th className={cls.th}>{t('code')}</th>
                <th className={cls.th}>{t('name')}</th>
                <th className={cls.th}>{t('manager')}</th>
                <th className={`${cls.th} text-end`}>{t('items')}</th>
                <th className={`${cls.th} text-end`}>{t('stock_value')}</th>
                <th className={cls.th}>{t('status')}</th>
                <th className={`${cls.th} text-end`}>{t('actions')}</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map(w => (
                  <tr key={w.id} className={`hover:bg-zinc-50 ${!w.isActive ? 'opacity-60' : ''}`}>
                    <td className={`${cls.td} font-mono text-xs font-semibold`}>{w.code}</td>
                    <td className={cls.td}>
                      <Link href={`/stock/availability/${w.id}`} className="font-medium text-zinc-900 hover:text-teal-700">{w.name}</Link>
                      {w.address && <p className="text-xs text-zinc-500">{w.address}</p>}
                    </td>
                    <td className={cls.td}>{w.manager || '—'}{w.phone && <p className="text-xs text-zinc-500" dir="ltr">{w.phone}</p>}</td>
                    <td className={cls.tdNum}>{f.qty(w.totalProducts)}{w.lowStockCount > 0 && <span className="ms-2"><Badge tone="amber">{t('low_count', { count: w.lowStockCount })}</Badge></span>}</td>
                    <td className={cls.tdNum}>{f.money(w.totalValue)}</td>
                    <td className={cls.td}>
                      <div className="flex flex-wrap gap-1">
                        {w.isDefault && <Badge tone="teal"><Star className="w-3 h-3" /> {t('default')}</Badge>}
                        {w.isActive ? <Badge tone="green">{t('active')}</Badge> : <Badge tone="zinc">{t('archived')}</Badge>}
                      </div>
                    </td>
                    <td className={`${cls.td} text-end whitespace-nowrap`}>
                      <Link href={`/stock/availability/${w.id}`} className={cls.btnGhost} title={t('view_stock')}><Eye className="w-4 h-4" /></Link>
                      <button onClick={() => openEdit(w)} className={cls.btnGhost} title={t('edit')}><Pencil className="w-4 h-4" /></button>
                      {w.isActive && !w.isDefault && <button onClick={() => patch(w, { isDefault: true })} className={cls.btnGhost} title={t('set_default')}><Star className="w-4 h-4" /></button>}
                      {w.isActive
                        ? <button onClick={() => patch(w, { isActive: false })} className={cls.btnGhost} title={t('archive')}><Archive className="w-4 h-4" /></button>
                        : <button onClick={() => patch(w, { isActive: true })} className={cls.btnGhost} title={t('unarchive')}><ArchiveRestore className="w-4 h-4" /></button>}
                      <button onClick={() => setConfirmDelete(w)} className={`${cls.btnGhost} hover:text-red-700`} title={t('delete')}><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} title={editing ? t('edit_warehouse') : t('new_warehouse')} onClose={() => setOpen(false)}
        footer={<>
          <button onClick={() => setOpen(false)} className={cls.btnSecondary}>{t('cancel')}</button>
          <button onClick={save} disabled={saving} className={cls.btnPrimary}>{saving ? '…' : t('save')}</button>
        </>}>
        {formError && <Alert onClose={() => setFormError('')}>{formError}</Alert>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={`${t('code')} *`}><input className={`${cls.input} ${fieldErrors.code ? 'border-red-500' : ''}`} aria-invalid={!!fieldErrors.code} value={form.code} maxLength={30} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="DEP-01" />{fieldErrors.code && <span className="block mt-1 text-xs text-red-600 text-start">{fieldErrors.code}</span>}</Field>
          <Field label={`${t('name')} *`}><input className={`${cls.input} ${fieldErrors.name ? 'border-red-500' : ''}`} aria-invalid={!!fieldErrors.name} value={form.name} maxLength={120} onChange={e => setForm({ ...form, name: e.target.value })} />{fieldErrors.name && <span className="block mt-1 text-xs text-red-600 text-start">{fieldErrors.name}</span>}</Field>
          <div className="sm:col-span-2"><Field label={t('address')}><input className={cls.input} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></Field></div>
          <Field label={t('manager')}><input className={cls.input} value={form.manager} onChange={e => setForm({ ...form, manager: e.target.value })} /></Field>
          <Field label={t('phone')}><input className={cls.input} dir="ltr" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
          <label className="sm:col-span-2 flex items-center gap-2 text-sm text-zinc-700">
            <input type="checkbox" className="accent-teal-600 w-4 h-4" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} /> {t('default_warehouse')}
          </label>
        </div>
      </Modal>

      <Modal open={!!confirmDelete} title={t('delete_warehouse')} onClose={() => setConfirmDelete(null)}
        footer={<>
          <button onClick={() => setConfirmDelete(null)} className={cls.btnSecondary}>{t('cancel')}</button>
          <button onClick={() => confirmDelete && remove(confirmDelete)} className={cls.btnDanger}>{t('delete')}</button>
        </>}>
        <p className="text-sm text-zinc-600 text-start">{t('delete_warehouse_confirm', { name: confirmDelete?.name ?? '' })}</p>
      </Modal>
    </StockPage>
  )
}
