'use client'

import { useState } from 'react'
import { X, User, Eye, EyeOff, Save } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface Tenant { id: string; name: string }

export default function CreateUserModal({ isOpen, onClose, tenants, onCreated }: {
  isOpen: boolean
  onClose: () => void
  tenants: Tenant[]
  onCreated: () => void
}) {
  const t = useTranslations('SuperAdmin.create_user')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [form, setForm] = useState({ tenantId: '', email: '', password: '', firstName: '', lastName: '', role: 'USER' })

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/super-admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onCreated()
      onClose()
      setForm({ tenantId: '', email: '', password: '', firstName: '', lastName: '', role: 'USER' })
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-zinc-950/90 backdrop-blur-md">
      <div className="bg-zinc-900 w-full max-w-lg rounded-[2.5rem] border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="p-8 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
              <User className="w-5 h-5 text-blue-500" />
            </div>
            <h3 className="text-xl font-black text-white">{t('title')}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-xl transition-all">
            <X className="w-5 h-5 text-zinc-500" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-4">
          {error && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm">⚠️ {error}</div>}

          <div>
            <label className="block text-xs font-black text-zinc-500 uppercase mb-1.5">{t('tenant')}</label>
            <select required className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all" value={form.tenantId} onChange={e => setForm(f => ({ ...f, tenantId: e.target.value }))}>
              <option value="">{t('select_tenant')}</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-black text-zinc-500 uppercase mb-1.5">{t('first_name')}</label>
              <input className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all" placeholder="Ahmed" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-black text-zinc-500 uppercase mb-1.5">{t('last_name')}</label>
              <input className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all" placeholder="Ben Ali" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-zinc-500 uppercase mb-1.5">{t('email')}</label>
            <input type="email" required className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all" placeholder="ahmed@abc.tn" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>

          <div>
            <label className="block text-xs font-black text-zinc-500 uppercase mb-1.5">{t('password')}</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} required minLength={10} maxLength={128} className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 pr-12 text-white focus:border-blue-500 outline-none transition-all" placeholder="••••••••" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
              <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute end-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-black text-zinc-500 uppercase mb-1.5">{t('role')}</label>
            <select className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:border-blue-500 outline-none transition-all" value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
              <option value="USER">{t('role_user')}</option>
              <option value="ADMIN">{t('role_admin')}</option>
            </select>
          </div>

          <div className="pt-4 flex gap-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-2xl transition-all text-sm">{t('cancel')}</button>
            <button type="submit" disabled={loading} className="flex-[2] flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 text-white font-bold rounded-2xl transition-all text-sm">
              {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
              {t('create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
