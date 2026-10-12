'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react'
import { StockPage, StockNav, PageHeader, Card, Loading, EmptyState, Alert, Badge, cls, api } from '@/components/stock/ui'

type Category = { id: string | null; name: string; description: string | null; productCount: number; managed: boolean }
type Unit = { id: string; code: string; name: string; decimals: number; productCount: number }

export default function StockSettingsPage() {
  const t = useTranslations('StockMod')
  const [settings, setSettings] = useState<{ allowNegativeStock: boolean; canEdit: boolean } | null>(null)
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [units, setUnits] = useState<Unit[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [newCat, setNewCat] = useState('')
  const [editCat, setEditCat] = useState<{ id: string; name: string } | null>(null)
  const [newUnit, setNewUnit] = useState({ code: '', name: '', decimals: '0' })

  const load = useCallback(async () => {
    const [s, c, u] = await Promise.all([
      api<{ allowNegativeStock: boolean; canEdit: boolean }>('/api/stock/settings'),
      api<Category[]>('/api/stock/categories'),
      api<Unit[]>('/api/stock/units'),
    ])
    if (s.ok) setSettings(s.data)
    if (c.ok) setCategories(c.data)
    if (u.ok) setUnits(u.data)
    const err = [s, c, u].find(r => !r.ok)
    if (err) setError(err.error || t('error_generic'))
  }, [t])
  useEffect(() => { load() }, [load])

  const handle = async (p: Promise<{ ok: boolean; error?: string }>, ok = t('saved')) => {
    const r = await p
    if (!r.ok) { setError(r.error === 'IN_USE' ? t('in_use_error') : (r.error || t('error_generic'))); return false }
    setNotice(ok); load(); return true
  }

  const canEdit = !!settings?.canEdit

  return (
    <StockPage>
      <PageHeader title={t('settings_title')} description={t('settings_desc')} />
      <StockNav />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert tone="green" onClose={() => setNotice('')}>{notice}</Alert>}
      {settings && !canEdit && <Alert tone="amber">{t('admin_only')}</Alert>}

      <div className="space-y-6">
        <Card title={t('rules')}>
          {!settings ? (error ? null : <Loading />) : (
            <div className="flex items-start gap-3 text-start">
              <input id="allow-negative-stock" type="checkbox" disabled={!canEdit} className="accent-teal-600 w-5 h-5 mt-0.5" checked={settings.allowNegativeStock}
                aria-describedby="allow-negative-stock-help"
                onChange={e => handle(api('/api/stock/settings', { method: 'PUT', body: JSON.stringify({ allowNegativeStock: e.target.checked }) }))} />
              <div>
                <label htmlFor="allow-negative-stock" className="block text-sm font-semibold text-zinc-900 cursor-pointer">{t('allow_negative')}</label>
                <p id="allow-negative-stock-help" className="mt-0.5 text-sm text-zinc-500">{t('allow_negative_desc')}</p>
              </div>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title={t('categories')} bodyClassName="p-0">
            {canEdit && (
              <form className="flex gap-2 p-4 border-b border-zinc-100" onSubmit={async e => { e.preventDefault(); if (newCat.trim() && await handle(api('/api/stock/categories', { method: 'POST', body: JSON.stringify({ name: newCat.trim() }) }))) setNewCat('') }}>
                <input className={cls.input} value={newCat} onChange={e => setNewCat(e.target.value)} placeholder={t('new_category')} maxLength={80} />
                <button className={cls.btnPrimary} type="submit"><Plus className="w-4 h-4" /> {t('add')}</button>
              </form>
            )}
            {!categories ? (error ? null : <Loading />) : categories.length === 0 ? <EmptyState title={t('no_category')} /> : (
              <ul className="divide-y divide-zinc-100">
                {categories.map(c => (
                  <li key={c.name} className="flex items-center justify-between gap-3 px-4 py-3">
                    {editCat && editCat.id === c.id ? (
                      <form className="flex flex-1 gap-2" onSubmit={async e => { e.preventDefault(); if (await handle(api(`/api/stock/categories/${c.id}`, { method: 'PUT', body: JSON.stringify({ name: editCat.name }) }))) setEditCat(null) }}>
                        <input className={cls.input} value={editCat.name} onChange={e => setEditCat({ ...editCat, name: e.target.value })} autoFocus />
                        <button type="submit" className={cls.btnGhost} aria-label={t('save')}><Check className="w-4 h-4" /></button>
                        <button type="button" onClick={() => setEditCat(null)} className={cls.btnGhost} aria-label={t('cancel')}><X className="w-4 h-4" /></button>
                      </form>
                    ) : (
                      <>
                        <span className="text-sm text-zinc-900 text-start">
                          {c.name}
                          <span className="ms-2 text-xs text-zinc-400">{t('product_count', { count: c.productCount })}</span>
                          {!c.managed && <span className="ms-2"><Badge tone="amber">{t('not_in_referential')}</Badge></span>}
                        </span>
                        {canEdit && (
                          <span className="whitespace-nowrap">
                            {c.managed && c.id ? (
                              <>
                                <button onClick={() => setEditCat({ id: c.id as string, name: c.name })} className={cls.btnGhost} aria-label={t('edit')}><Pencil className="w-4 h-4" /></button>
                                <button disabled={c.productCount > 0} title={c.productCount > 0 ? t('in_use_error') : t('delete')} onClick={() => handle(api(`/api/stock/categories/${c.id}`, { method: 'DELETE' }), t('deleted'))} className={`${cls.btnGhost} hover:text-red-700`} aria-label={t('delete')}><Trash2 className="w-4 h-4" /></button>
                              </>
                            ) : (
                              <button onClick={() => handle(api('/api/stock/categories', { method: 'POST', body: JSON.stringify({ name: c.name }) }))} className={cls.btnGhost}><Plus className="w-4 h-4" /> {t('add_to_referential')}</button>
                            )}
                          </span>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={t('units')} bodyClassName="p-0">
            {canEdit && (
              <form className="grid grid-cols-[1fr_2fr_auto_auto] gap-2 p-4 border-b border-zinc-100" onSubmit={async e => {
                e.preventDefault()
                if (!newUnit.code.trim() || !newUnit.name.trim()) return
                if (await handle(api('/api/stock/units', { method: 'POST', body: JSON.stringify({ ...newUnit, decimals: Number(newUnit.decimals) }) }))) setNewUnit({ code: '', name: '', decimals: '0' })
              }}>
                <input className={cls.input} value={newUnit.code} onChange={e => setNewUnit({ ...newUnit, code: e.target.value })} placeholder={t('code')} maxLength={20} />
                                <input className={cls.input} value={newUnit.name} onChange={e => setNewUnit({ ...newUnit, name: e.target.value })} placeholder={t('name')} maxLength={60} />
                                <select className={cls.input} value={newUnit.decimals} onChange={e => setNewUnit({ ...newUnit, decimals: e.target.value })} aria-label={t('decimals')}>
                                  {[0, 1, 2, 3].map(d => <option key={d} value={d}>{t('decimals_n', { count: d })}</option>)}
                                </select>
                                <button className={cls.btnPrimary} type="submit"><Plus className="w-4 h-4" /></button>
                              </form>
                            )}
                            {!units ? (error ? null : <Loading />) : (
                              <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
                                <table className={cls.table}>
                <thead className="bg-zinc-50"><tr>
                  <th className={cls.th}>{t('code')}</th>
                  <th className={cls.th}>{t('name')}</th>
                  <th className={`${cls.th} text-end`}>{t('decimals')}</th>
                  <th className={`${cls.th} text-end`}>{t('products')}</th>
                  <th className={cls.th}></th>
                </tr></thead>
                <tbody className="divide-y divide-zinc-100">
                  {units.map(u => (
                    <tr key={u.id}>
                      <td className={`${cls.td} font-mono text-xs font-semibold`}>{u.code}</td>
                      <td className={cls.td}>{u.name}</td>
                      <td className={cls.tdNum}>{u.decimals}</td>
                      <td className={cls.tdNum}>{u.productCount}</td>
                      <td className={`${cls.td} text-end`}>
                        {canEdit && <button disabled={u.productCount > 0} title={u.productCount > 0 ? t('in_use_error') : t('delete')} onClick={() => handle(api(`/api/stock/units/${u.id}`, { method: 'DELETE' }), t('deleted'))} className={`${cls.btnGhost} hover:text-red-700`} aria-label={t('delete')}><Trash2 className="w-4 h-4" /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        </div>
      </div>
    </StockPage>
  )
}
