"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Save, Settings, Tag, Calendar, DollarSign, Loader2, Calculator } from "lucide-react";
import { useTranslations } from 'next-intl'
import SmartInput from '@/components/ui/SmartInput'
import type { Suggestion } from '@/components/ui/SmartInput'

interface AssetFormModalProps {
  onClose: () => void;
  onSave: () => void;
  tenantId: string;
}

export function AssetFormModal({ onClose, onSave, tenantId }: AssetFormModalProps) {
  const t = useTranslations('GMAO.assets.form')
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assets, setAssets] = useState<any[]>([]);

  // Saisie intelligente : catégories et lieux déjà utilisés sur les actifs existants
  useEffect(() => {
    fetch(`/api/gmao/assets?tenantId=${tenantId}`)
      .then(r => (r.ok ? r.json() : []))
      .then((list: any[]) => setAssets(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [tenantId]);

  const categorySuggestions: Suggestion[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) {
      const c = (a.category || '').trim();
      if (c) counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  }, [assets]);

  const locationSuggestions: Suggestion[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets) {
      const l = (a.location || '').trim();
      if (l) counts.set(l, (counts.get(l) || 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  }, [assets]);

   const [formData, setFormData] = useState({
     code: "",
     name: "",
     description: "",
     category: "",
     location: "",
     purchaseDate: new Date().toISOString().split("T")[0],
     purchaseValue: "",
     salvageValue: "",
     usefulLife: "",
     amortizationMethod: "LINEAR",
     warrantyEnd: "",
     status: "ACTIVE",
   });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/gmao/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          tenantId,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || t('error'));
      }

      onSave();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div>
            <h2 className="text-2xl font-black text-stone-900">{t('title')}</h2>
            <p className="text-sm font-medium text-stone-500 mt-1">{t('subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <form id="asset-form" onSubmit={handleSubmit} className="space-y-8">
            
            {error && (
              <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100">
                {error}
              </div>
            )}

            <div className="space-y-6">
              <h3 className="text-sm font-bold text-teal-600 uppercase tracking-wider flex items-center gap-2">
                <Settings className="w-4 h-4" /> {t('details')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('code')} <span className="text-red-500">*</span></label>
                  <input required name="code" value={formData.code} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all" placeholder={t('code_placeholder')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('name')} <span className="text-red-500">*</span></label>
                  <input required name="name" value={formData.name} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all" placeholder={t('name_placeholder')} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-semibold text-stone-700">{t('description')}</label>
                  <textarea name="description" value={formData.description} onChange={handleChange} rows={2} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('category')}</label>
                  <SmartInput
                    name="category"
                    value={formData.category}
                    onChange={v => setFormData(prev => ({ ...prev, category: v }))}
                    suggestions={categorySuggestions}
                    placeholder={t('category_placeholder')}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('location')}</label>
                  <SmartInput
                    name="location"
                    value={formData.location}
                    onChange={v => setFormData(prev => ({ ...prev, location: v }))}
                    suggestions={locationSuggestions}
                    placeholder={t('location_placeholder')}
                  />
                </div>
              </div>
            </div>

            <div className="w-full h-px bg-stone-100" />

            <div className="space-y-6">
              <h3 className="text-sm font-bold text-teal-600 uppercase tracking-wider flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> {t('acquisition')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('purchase_date')}</label>
                  <input type="date" name="purchaseDate" value={formData.purchaseDate} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('warranty_end')}</label>
                  <input type="date" name="warrantyEnd" value={formData.warrantyEnd} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                </div>
                 <div className="space-y-2">
                   <label className="text-sm font-semibold text-stone-700">{t('acquisition_value')}</label>
                   <input type="number" step="0.001" name="purchaseValue" value={formData.purchaseValue} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                 </div>
                 <div className="space-y-2">
                   <label className="text-sm font-semibold text-stone-700">{t('residual_value')}</label>
                   <input type="number" step="0.001" name="salvageValue" value={formData.salvageValue} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                 </div>
                 <div className="space-y-2">
                   <label className="text-sm font-semibold text-stone-700">{t('lifespan')}</label>
                   <input type="number" step="1" name="usefulLife" value={formData.usefulLife} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all" />
                 </div>
                 <div className="space-y-2">
                   <label className="text-sm font-semibold text-stone-700">{t('depreciation')}</label>
                   <select name="amortizationMethod" value={formData.amortizationMethod} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all">
                     <option value="LINEAR">{t('linear')}</option>
                     <option value="DEGRESSIVE">{t('degressive')}</option>
                   </select>
                 </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('initial_status')}</label>
                  <select name="status" value={formData.status} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all">
                    <option value="ACTIVE">{t('active')}</option>
                    <option value="IN_MAINTENANCE">{t('in_maintenance')}</option>
                    <option value="BROKEN">{t('broken')}</option>
                    <option value="RETIRED">{t('retired')}</option>
                  </select>
                </div>
              </div>
            </div>

          </form>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-stone-100 bg-stone-50/50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl font-bold text-sm text-stone-600 bg-white border border-stone-200 hover:bg-stone-50 transition-colors"
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            form="asset-form"
            disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm text-white bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
