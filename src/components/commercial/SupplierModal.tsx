'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { X, Save, User, Mail, Phone, MapPin, Building2, ShieldCheck, Truck } from 'lucide-react'
import gsap from 'gsap'
import { readApiError } from '@/lib/zod-helpers'

interface SupplierModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  tenantId: string
  supplier?: any // For edit mode
}

export default function SupplierModal({ isOpen, onClose, onSuccess, tenantId, supplier }: SupplierModalProps) {
  const t = useTranslations('Commercial.Suppliers.modal')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    matriculeFiscal: '', 
  })

  useEffect(() => {
    if (supplier) {
      setFormData({
        name: supplier.name || '',
        code: supplier.code || '',
        email: supplier.email || '',
        phone: supplier.phone || '',
        address: supplier.address || '',
        city: supplier.city || '',
        matriculeFiscal: supplier.matriculeFiscal || '',
      })
    } else {
      setFormData({
        name: '',
        code: `SUP-${Math.floor(Math.random() * 10000)}`,
        email: '',
        phone: '',
        address: '',
        city: '',
        matriculeFiscal: '',
      })
    }
  }, [supplier, isOpen])

  useEffect(() => {
    if (isOpen) {
      setError('')
      gsap.fromTo('.modal-content-sup', 
        { scale: 0.9, opacity: 0, y: 20 }, 
        { scale: 1, opacity: 1, y: 0, duration: 0.4, ease: 'back.out(1.7)' }
      )
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    
    try {
      const url = supplier ? `/api/commercial/suppliers/${supplier.id}` : '/api/commercial/suppliers'
      const method = supplier ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, tenantId }),
      })

      if (res.ok) {
        onSuccess()
        onClose()
      } else {
        // Ne jamais échouer en silence : afficher le message renvoyé par l'API (validation, doublon, droits…)
        setError(await readApiError(res, t('save_error')))
      }
    } catch (err) {
      console.error(err)
      setError(t('save_error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-md">
      <div className="modal-content-sup bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl shadow-amber-500/5 text-start">
        
        {/* Header */}
        <div className="p-8 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between bg-gradient-to-r from-stone-50 to-white dark:from-zinc-900 dark:to-zinc-800/50">
          <div className="flex items-center gap-3">
             <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20">
                <Truck className="w-6 h-6 text-amber-600 dark:text-amber-400" />
             </div>
             <div>
                <h2 className="text-2xl font-black text-stone-900 dark:text-white tracking-tight">{supplier ? t('title_edit') : t('title_new')}</h2>
                <p className="text-stone-500 dark:text-zinc-500 text-xs font-bold uppercase tracking-widest">{t('ficha')}</p>
             </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-stone-200 dark:hover:bg-zinc-800 rounded-xl text-stone-400 dark:text-zinc-500 transition-all"><X className="w-6 h-6" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('name_label')}</label>
              <div className="relative">
                <Building2 className="w-4 h-4 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400 dark:text-zinc-600" />
                <input 
                  required
                  value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl ps-12 pe-4 py-3 text-stone-900 dark:text-white focus:border-amber-500 shadow-inner transition-all outline-none text-start"
                  placeholder={t('name_placeholder')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('matricule_label')}</label>
              <div className="relative">
                <ShieldCheck className="w-4 h-4 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400 dark:text-zinc-600" />
                <input 
                  required
                  value={formData.matriculeFiscal}
                  onChange={e => setFormData({...formData, matriculeFiscal: e.target.value})}
                  className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl ps-12 pe-4 py-3 text-stone-900 dark:text-white focus:border-amber-500 shadow-inner transition-all outline-none font-mono text-start"
                  placeholder={t('matricule_placeholder')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('email_label')}</label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400 dark:text-zinc-600" />
                <input 
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl ps-12 pe-4 py-3 text-stone-900 dark:text-white focus:border-amber-500 shadow-inner transition-all outline-none text-start"
                  placeholder={t('email_placeholder')}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('phone_label')}</label>
              <div className="relative">
                <Phone className="w-4 h-4 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400 dark:text-zinc-600" />
                <input 
                  value={formData.phone}
                  onChange={e => setFormData({...formData, phone: e.target.value})}
                  className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl ps-12 pe-4 py-3 text-stone-900 dark:text-white focus:border-amber-500 shadow-inner transition-all outline-none text-start"
                  placeholder={t('phone_placeholder')}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('address_label')}</label>
            <div className="relative">
              <MapPin className="w-4 h-4 absolute inset-inline-start-4 top-8 -translate-y-1/2 text-stone-400 dark:text-zinc-600" />
              <textarea 
                rows={2}
                value={formData.address}
                onChange={e => setFormData({...formData, address: e.target.value})}
                className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl ps-12 pe-4 py-3 text-stone-900 dark:text-white focus:border-amber-500 shadow-inner transition-all outline-none text-start"
                placeholder={t('address_placeholder')}
              />
            </div>
          </div>

          <div className="space-y-2">
               <label className="text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('city_label')}</label>
               <input 
                 value={formData.city}
                 onChange={e => setFormData({...formData, city: e.target.value})}
                 className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-stone-900 dark:text-white focus:border-amber-500 shadow-inner transition-all outline-none text-start"
                 placeholder={t('city_placeholder')}
               />
          </div>

          {error && (
            <div role="alert" className="p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-300 rounded-2xl text-sm font-bold">
              {error}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex gap-4 pt-4">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 py-4 bg-stone-100 dark:bg-zinc-800 rounded-2xl text-xs font-black uppercase tracking-widest text-stone-500 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-white transition-all border border-transparent hover:border-stone-200 dark:hover:border-zinc-700"
            >
              {t('cancel')}
            </button>
            <button 
              type="submit" 
              disabled={loading}
              className="flex-[2] py-4 bg-amber-600 rounded-2xl text-xs font-black uppercase tracking-widest text-white hover:bg-amber-500 transition-all shadow-lg shadow-amber-600/20 flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              {loading ? t('saving') : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
