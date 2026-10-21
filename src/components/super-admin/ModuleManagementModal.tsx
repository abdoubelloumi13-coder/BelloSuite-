'use client'

import { useState, useEffect } from 'react'
import { X, CheckCircle, Circle, Save, ShieldAlert } from 'lucide-react'
import gsap from 'gsap'
import { useTranslations } from 'next-intl'

export default function ModuleManagementModal({ isOpen, onClose, tenant, allModules, onUpdate }: any) {
  const t = useTranslations('SuperAdmin.modules_modal')
  const [enabledModules, setEnabledModules] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (tenant) {
      setEnabledModules(tenant.activeModuleIds || [])
    }
  }, [tenant])

  if (!isOpen || !tenant) return null

  const handleToggle = (moduleId: string) => {
    setEnabledModules(prev => 
      prev.includes(moduleId) 
        ? prev.filter(id => id !== moduleId) 
        : [...prev, moduleId]
    )
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      // Route protégée (requireSuperAdmin) : un seul appel avec la sélection complète
      const res = await fetch(`/api/super-admin/tenants/${encodeURIComponent(tenant.id)}/modules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modules: allModules.map((mod: any) => ({ moduleId: mod.id, isEnabled: enabledModules.includes(mod.id) })),
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Échec')
      onUpdate()
      onClose()
    } catch (error) {
      console.error('Failed to update modules:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
      <div className="bg-zinc-900 w-full max-w-lg rounded-[2.5rem] border border-zinc-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div>
            <h3 className="text-2xl font-black text-white tracking-tight">{t('title')}</h3>
            <p className="text-zinc-500 text-sm font-medium mt-1">{t('client', { name: tenant.name })}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-xl transition-all">
            <X className="w-6 h-6 text-zinc-500" />
          </button>
        </div>

        <div className="p-8 space-y-4">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex gap-3 mb-6">
             <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
             <p className="text-[10px] font-black uppercase tracking-widest text-amber-200/70 leading-relaxed">
               {t('billing_note')}
             </p>
          </div>

          <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {allModules.map((mod: any) => {
              const isEnabled = enabledModules.includes(mod.id)
              return (
                <button
                  key={mod.id}
                  onClick={() => handleToggle(mod.id)}
                  className={`flex items-center justify-between p-4 rounded-3xl border transition-all ${
                    isEnabled 
                    ? 'bg-emerald-500/5 border-emerald-500/30 text-white shadow-[0_0_20px_-10px_rgba(16,185,129,0.3)]' 
                    : 'bg-zinc-800/50 border-zinc-800 text-zinc-500 grayscale opacity-60 hover:opacity-100 hover:grayscale-0'
                  }`}
                >
                  <div className="flex items-center gap-4 text-start">
                    <div className={`p-3 rounded-2xl ${isEnabled ? 'bg-emerald-500/10' : 'bg-zinc-700/50'}`}>
                       <span className="text-xl">{mod.icon}</span>
                    </div>
                    <div>
                      <p className="font-bold text-sm">{mod.displayName}</p>
                      <p className="text-[10px] font-black uppercase tracking-tighter opacity-50">{t('per_month', { price: mod.monthlyPrice })}</p>
                    </div>
                  </div>
                  {isEnabled ? (
                    <CheckCircle className="w-6 h-6 text-emerald-500" />
                  ) : (
                    <Circle className="w-6 h-6 text-zinc-700" />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="p-8 bg-zinc-950/50 border-t border-zinc-800 flex gap-4">
          <button 
            disabled={loading}
            onClick={onClose}
            className="flex-1 py-4 bg-zinc-900 border border-zinc-800 rounded-2xl text-xs font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all"
          >
            {t('cancel')}
          </button>
          <button 
            disabled={loading}
            onClick={handleSave}
            className="flex-[2] py-4 bg-emerald-500 hover:bg-emerald-400 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="animate-pulse">{t('updating')}</span>
            ) : (
              <>
                <Save className="w-4 h-4" />
                {t('save')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
