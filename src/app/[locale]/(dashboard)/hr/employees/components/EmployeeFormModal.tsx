"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Save, User as UserIcon, Briefcase, Loader2, Users } from "lucide-react";
import { useTranslations } from 'next-intl'
import SmartInput from '@/components/ui/SmartInput'
import type { Suggestion } from '@/components/ui/SmartInput'
import { apiErrorMessage } from '@/lib/zod-helpers'
import { ETATS_CIVILS } from '@/lib/employee-family'

interface EmployeeFormModalProps {
  onClose: () => void;
  onSave: () => void;
  tenantId: string;
  /** Employé à modifier (sinon création) */
  employee?: Record<string, any> | null;
}

const toDateInput = (v: unknown) => {
  if (!v) return "";
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
};

export function EmployeeFormModal({ onClose, onSave, tenantId, employee }: EmployeeFormModalProps) {
  const isEdit = Boolean(employee?.id);
  const t = useTranslations('HR.employees.form')
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [employees, setEmployees] = useState<any[]>([]);

  // Saisie intelligente : postes et départements déjà utilisés
  useEffect(() => {
    fetch(`/api/hr/employees?tenantId=${tenantId}`)
      .then(r => (r.ok ? r.json() : []))
      .then((list: any[]) => setEmployees(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [tenantId]);

  const posteSuggestions: Suggestion[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      const p = (e.poste || '').trim();
      if (p) counts.set(p, (counts.get(p) || 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  }, [employees]);

  const departementSuggestions: Suggestion[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      const d = (e.departement || '').trim();
      if (d) counts.set(d, (counts.get(d) || 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  }, [employees]);

  const [formData, setFormData] = useState(() => ({
    employeeNumber: employee?.employeeNumber ?? "",
    firstName: employee?.firstName ?? "",
    lastName: employee?.lastName ?? "",
    email: employee?.email ?? "",
    phone: employee?.phone ?? "",
    cin: employee?.cin ?? "",
    typeContrat: employee?.typeContrat ?? "CDI",
    poste: employee?.poste ?? "",
    departement: employee?.departement ?? "",
    salary: employee?.salary !== undefined && employee?.salary !== null ? String(Number(employee.salary)) : "",
    hireDate: toDateInput(employee?.hireDate) || new Date().toISOString().split("T")[0],
    modePaie: employee?.modePaie ?? "VIREMENT",
    cnssNumber: employee?.cnssNumber ?? "",
    etatCivil: employee?.etatCivil ?? "CELIBATAIRE",
    chefFamille: employee?.situationFamiliale === "CHEF_FAMILLE",
    enfantsCharge: String(employee?.enfantsCharge ?? 0),
  }));

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (e.target instanceof HTMLInputElement && e.target.type === "checkbox") {
      const checked = e.target.checked;
      setFormData((prev) => ({ ...prev, [name]: checked }));
      return;
    }
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { chefFamille, enfantsCharge, ...rest } = formData;
      const children = Number(enfantsCharge || 0);
      if (!Number.isInteger(children) || children < 0 || children > 20) {
        throw new Error("Enfants à charge : nombre entier de 0 à 20 attendu");
      }
      const res = await fetch(isEdit ? `/api/hr/employees/${employee!.id}` : "/api/hr/employees", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...rest,
          email: rest.email.trim() || null,
          tenantId,
          salary: parseFloat(String(rest.salary).replace(",", ".")) || 0,
          enfantsCharge: children,
          situationFamiliale: chefFamille ? "CHEF_FAMILLE" : "NON_CHEF_FAMILLE",
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(apiErrorMessage(errorData, t('error')));
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
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-8 py-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div>
            <h2 className="text-2xl font-black text-stone-900">{isEdit ? t('edit_title') : t('title')}</h2>
            <p className="text-sm font-medium text-stone-500 mt-1">{isEdit ? t('edit_subtitle') : t('subtitle')}</p>
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
          <form id="employee-form" onSubmit={handleSubmit} className="space-y-8">
            
            {error && (
              <div className="p-4 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100">
                {error}
              </div>
            )}

            <div className="space-y-6">
              <h3 className="text-sm font-bold text-teal-600 uppercase tracking-wider flex items-center gap-2">
                <UserIcon className="w-4 h-4" /> {t('personal')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('id_number')} <span className="text-red-500">*</span></label>
                  <input required name="employeeNumber" value={formData.employeeNumber} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" placeholder={t('id_placeholder')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('cin')}</label>
                  <input name="cin" value={formData.cin} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" placeholder={t('cin_placeholder')} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('first_name')} <span className="text-red-500">*</span></label>
                  <input required name="firstName" value={formData.firstName} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('last_name')} <span className="text-red-500">*</span></label>
                  <input required name="lastName" value={formData.lastName} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('email')}</label>
                  <input type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('phone')}</label>
                  <input name="phone" value={formData.phone} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                </div>
              </div>
            </div>

            <div className="w-full h-px bg-stone-100" />

            <div className="space-y-6">
              <h3 className="text-sm font-bold text-teal-600 uppercase tracking-wider flex items-center gap-2">
                <Briefcase className="w-4 h-4" /> {t('professional')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('position')}</label>
                  <SmartInput
                    name="poste"
                    value={formData.poste}
                    onChange={v => setFormData(prev => ({ ...prev, poste: v }))}
                    suggestions={posteSuggestions}
                    placeholder={t('position_placeholder') || ''}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('department')}</label>
                  <SmartInput
                    name="departement"
                    value={formData.departement}
                    onChange={v => setFormData(prev => ({ ...prev, departement: v }))}
                    suggestions={departementSuggestions}
                    placeholder={t('department_placeholder') || ''}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('contract_type')}</label>
                  <select name="typeContrat" value={formData.typeContrat} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all">
                    {/* Valeurs de l'enum TypeContrat (SIVP / KARAMA n'existent pas en base → création refusée) */}
                    <option value="CDI">CDI</option>
                    <option value="CDD">CDD</option>
                    <option value="STAGE">{t('contract_STAGE')}</option>
                    <option value="SAISONNIER">{t('contract_SAISONNIER')}</option>
                    <option value="INTERIM">{t('contract_INTERIM')}</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('hire_date')}</label>
                  <input type="date" name="hireDate" value={formData.hireDate} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('base_salary')}</label>
                  <input type="number" step="0.001" name="salary" value={formData.salary} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-stone-700">{t('cnss')}</label>
                  <input name="cnssNumber" value={formData.cnssNumber} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                </div>
              </div>
            </div>

            <div className="w-full h-px bg-stone-100" />

            <div className="space-y-6">
              <h3 className="text-sm font-bold text-teal-600 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-4 h-4" /> {t('family')}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label htmlFor="emp-etatCivil" className="text-sm font-semibold text-stone-700">{t('marital_status')}</label>
                  <select id="emp-etatCivil" name="etatCivil" value={formData.etatCivil} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all">
                    {ETATS_CIVILS.map((e) => (
                      <option key={e} value={e}>{t(`marital_${e}`)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="emp-enfants" className="text-sm font-semibold text-stone-700">{t('children')}</label>
                  <input id="emp-enfants" type="number" min={0} max={20} step={1} name="enfantsCharge" value={formData.enfantsCharge} onChange={handleChange} className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none transition-all" />
                  <p className="text-xs text-stone-400">{t('children_hint')}</p>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-stone-700 pt-8 cursor-pointer">
                    <input type="checkbox" name="chefFamille" checked={formData.chefFamille} onChange={handleChange} className="w-4 h-4 accent-teal-600" />
                    {t('head_of_family')}
                  </label>
                  <p className="text-xs text-stone-400">{t('head_of_family_hint')}</p>
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
            form="employee-form"
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
