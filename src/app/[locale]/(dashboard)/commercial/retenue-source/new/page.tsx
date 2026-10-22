'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useSession } from '@/hooks/useSession';
import { ChevronLeft, Save, X, Info, Calculator, DollarSign, Calendar, User, FileText, RefreshCw, XCircle } from 'lucide-react';
import { calculerRS, getRSRule, type BeneficiaryRegime, type BeneficiaryType, type ServiceType } from '@/lib/retenue-source';

const REGIMES: BeneficiaryRegime[] = ['IS_20', 'IS_10', 'STANDARD', 'FORFAIT', 'HOTEL'];
const pct = (taux: number) => `${(taux * 100).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;

export default function NewRetenueSourcePage() {
  const tc = useTranslations('Common.errors')
  const { tenantId } = useSession();
  const t = useTranslations('Commercial.RetenueSource.RetenueSourceEditor');
  const locale = useLocale();
  const router = useRouter();
  
  const SERVICE_TYPE_VALUES: ServiceType[] = ['PRESTATION_SERVICE', 'HONORAIRES', 'LOYERS', 'DIVIDENDES', 'INTERETS', 'ROYALTIES', 'REMUNERATION', 'AUTRE'];

  const BENEFICIARY_TYPES = [
    { value: 'INDIVIDU', label: t('beneficiary.type_individu') },
    { value: 'SOCIETE', label: t('beneficiary.type_societe') },
  ];

  const [form, setForm] = useState({
    beneficiaryName: '',
    beneficiaryTin: '',
    beneficiaryType: 'INDIVIDU',
    beneficiaryRegime: 'STANDARD' as BeneficiaryRegime,
    beneficiaryEmail: '',
    beneficiaryPhone: '',
    beneficiaryAddress: '',
    serviceType: 'PRESTATION_SERVICE',
    grossAmount: '',
    vatRate: '19',
    periodMonth: String(new Date().getMonth() + 1).padStart(2, '0'),
    periodYear: String(new Date().getFullYear()),
    paymentDate: '',
    paymentMethod: '',
    paymentReference: '',
    invoiceId: '',
    notes: '',
    tenantId: 'demo', 
  });

  useEffect(() => {
    setForm(prev => ({ ...prev, tenantId }));
  }, [tenantId]);

  const [preview, setPreview] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // Erreurs renvoyées par le serveur champ par champ (zod) : affichées sous le champ concerné
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fieldError = (name: string) => fieldErrors[name] ? (
    <p role="alert" className="text-[11px] font-bold text-red-600 dark:text-red-400 px-1 mt-1">{fieldErrors[name]}</p>
  ) : null;
  const errBorder = (name: string) => fieldErrors[name] ? ' !border-red-500' : '';

  const SERVICE_TYPES = SERVICE_TYPE_VALUES.map((value) => ({
    value,
    label: t(`service_types.${value}`),
    taux: pct(getRSRule(value, form.beneficiaryType as BeneficiaryType, form.beneficiaryRegime).taux),
  }));
  const selectedService = SERVICE_TYPES.find((s) => s.value === form.serviceType);

  function calculateRS() {
    const montant = parseFloat(form.grossAmount);
    if (!montant || !form.serviceType) return null;

    const r = calculerRS({
      montantBrut: montant,
      serviceType: form.serviceType as ServiceType,
      beneficiaryType: form.beneficiaryType as BeneficiaryType,
      regime: form.beneficiaryRegime,
    });
    return { taux: r.taux, taxAmount: r.montantRS, netAmount: r.montantNet, label: r.label };
  }

  useEffect(() => {
    setPreview(calculateRS());
  }, [form.grossAmount, form.serviceType, form.beneficiaryType, form.beneficiaryRegime]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});
    try {
      const res = await fetch('/api/commercial/retenue-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        else if (data.field) setFieldErrors({ [data.field]: data.error });
        throw new Error(data.error || tc('create_failed'));
      }
      router.push('/commercial/retenue-source');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const fmt = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-TN' : 'fr-TN', { 
    style: 'currency', 
    currency: 'TND', 
    maximumFractionDigits: 3 
  });

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8 text-start">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-black text-stone-900 dark:text-white tracking-tight flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20">
              <DollarSign className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            {t('title_new')}
          </h1>
          <p className="text-stone-500 dark:text-zinc-500 font-medium">{t('subtitle_new')}</p>
        </div>
        <button onClick={() => router.back()} className="p-2.5 bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-2xl text-stone-400 dark:text-zinc-500 hover:text-stone-600 dark:hover:text-white transition-all shadow-sm">
          <X className="w-6 h-6" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Bénéficiaire Section */}
        <section className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-xl shadow-stone-200/50 dark:shadow-none space-y-6">
          <div className="flex items-center gap-3 border-b border-stone-100 dark:border-zinc-800 pb-5">
            <div className="p-2 bg-amber-500/10 rounded-xl">
              <User className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-xs font-black text-stone-900 dark:text-white uppercase tracking-[0.2em]">{t('beneficiary.title')}</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('beneficiary.name_label')}</label>
              <input
                required
                className={"w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 transition-all shadow-inner text-start" + errBorder('beneficiaryName')}
                value={form.beneficiaryName}
                onChange={(e) => setForm((f) => ({ ...f, beneficiaryName: e.target.value }))}
                placeholder={t('beneficiary.name_placeholder')}
              />
              {fieldError('beneficiaryName')}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('beneficiary.tin_label')}</label>
              <input
                className={"w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 transition-all shadow-inner font-mono tracking-widest text-start" + errBorder('beneficiaryTin')}
                value={form.beneficiaryTin}
                onChange={(e) => setForm((f) => ({ ...f, beneficiaryTin: e.target.value.toUpperCase() }))}
                placeholder={t('beneficiary.tin_placeholder')}
                // Matricule complet : 13 caractères (1234567AAM000), jusqu'à 17 avec séparateurs (1234567/A/A/M/000)
                maxLength={17}
                autoCapitalize="characters"
              />
              {fieldError('beneficiaryTin')}
            </div>
          </div>
          
          <div className="space-y-3">
            <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('beneficiary.type_label')}</label>
            <div className="flex flex-wrap gap-4">
              {BENEFICIARY_TYPES.map((bt) => (
                <label key={bt.value} className={`flex-1 min-w-[140px] flex items-center justify-center gap-3 px-6 py-4 rounded-2xl border cursor-pointer transition-all ${form.beneficiaryType === bt.value ? 'bg-stone-900 dark:bg-white border-stone-900 dark:border-white text-white dark:text-stone-900 shadow-xl scale-[1.02]' : 'bg-stone-50 dark:bg-zinc-950 border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-500 hover:bg-stone-100 dark:hover:bg-zinc-800'}`}>
                  <input
                    type="radio"
                    className="hidden"
                    name="beneficiaryType"
                    value={bt.value}
                    checked={form.beneficiaryType === bt.value}
                    onChange={(e) => setForm((f) => ({ ...f, beneficiaryType: e.target.value }))}
                  />
                  <span className="text-xs font-black uppercase tracking-widest">{bt.label}</span>
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Prestation Section */}
        <section className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-xl shadow-stone-200/50 dark:shadow-none space-y-6">
          <div className="flex items-center gap-3 border-b border-stone-100 dark:border-zinc-800 pb-5">
            <div className="p-2 bg-amber-500/10 rounded-xl">
              <FileText className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-xs font-black text-stone-900 dark:text-white uppercase tracking-[0.2em]">{t('service.title')}</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('service.label')}</label>
              <div className="relative">
                 <select
                   className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 transition-all appearance-none cursor-pointer shadow-inner"
                   value={form.serviceType}
                   onChange={(e) => setForm((f) => ({ ...f, serviceType: e.target.value }))}
                 >
                   {SERVICE_TYPES.map((s) => (
                     <option key={s.value} value={s.value}>{s.label}</option>
                   ))}
                 </select>
                 <div className="absolute inset-inline-end-4 top-1/2 -translate-y-1/2 pointer-events-none text-stone-400">
                    <ChevronLeft className="w-5 h-5 rotate-[270deg]" />
                 </div>
              </div>
              {selectedService && (
                <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 px-1 uppercase tracking-tighter mt-1">
                  {t('service.rate_prefix')}{selectedService.taux}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('service.amount_label')}</label>
              <div className="relative">
                <input
                  required
                  type="number"
                  min="0"
                  step="0.001"
                  className={"w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-black text-stone-900 dark:text-white outline-none focus:border-amber-500 transition-all shadow-inner font-mono text-start" + errBorder('grossAmount')}
                  value={form.grossAmount}
                  onChange={(e) => setForm(f => ({ ...f, grossAmount: e.target.value }))}
                  placeholder="0.000"
                />
                <span className="absolute inset-inline-end-5 top-1/2 -translate-y-1/2 text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase">TND</span>
              </div>
              {fieldError('grossAmount')}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('regime.label')}</label>
              <select
                className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 transition-all cursor-pointer shadow-inner"
                value={form.beneficiaryRegime}
                onChange={(e) => setForm((f) => ({ ...f, beneficiaryRegime: e.target.value as BeneficiaryRegime }))}
              >
                {REGIMES.map((r) => (
                  <option key={r} value={r}>{t(`regime.${r}`)}</option>
                ))}
              </select>
              {preview?.label && (
                <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 px-1 tracking-tighter mt-1">{preview.label}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('contact.vat_label')}</label>
              <select
                className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 transition-all cursor-pointer shadow-inner"
                value={form.vatRate}
                onChange={(e) => setForm((f) => ({ ...f, vatRate: e.target.value }))}
              >
                {['0', '7', '13', '19'].map((v) => (
                  <option key={v} value={v}>{v} %</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('contact.title')}</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                type="email"
                className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 shadow-inner"
                placeholder={t('contact.email_label')}
                value={form.beneficiaryEmail}
                onChange={(e) => setForm((f) => ({ ...f, beneficiaryEmail: e.target.value }))}
              />
              <input
                type="tel"
                className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 shadow-inner"
                placeholder={t('contact.phone_label')}
                value={form.beneficiaryPhone}
                onChange={(e) => setForm((f) => ({ ...f, beneficiaryPhone: e.target.value }))}
              />
              <input
                type="text"
                className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 shadow-inner"
                placeholder={t('contact.address_label')}
                value={form.beneficiaryAddress}
                onChange={(e) => setForm((f) => ({ ...f, beneficiaryAddress: e.target.value }))}
              />
            </div>
            {fieldError('beneficiaryEmail')}{fieldError('beneficiaryPhone')}{fieldError('beneficiaryAddress')}
          </div>

          {/* Calcul Preview */}
          {preview && parseFloat(form.grossAmount) > 0 && (
            <div className="bg-stone-900 dark:bg-zinc-950 border border-stone-800 dark:border-zinc-800 rounded-[2rem] p-8 space-y-6 shadow-2xl">
              <div className="flex items-center gap-3 text-amber-400">
                <div className="p-2 bg-amber-400/10 rounded-xl">
                   <Calculator className="w-4 h-4" />
                </div>
                <h3 className="text-[10px] font-black uppercase tracking-[0.2em]">{t('preview.title')}</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-stone-500 uppercase tracking-widest">{t('preview.gross_ht')}</p>
                  <p className="text-lg font-black text-white font-mono">{fmt(Number(form.grossAmount))}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-stone-500 uppercase tracking-widest">{t('preview.rate_applied')}</p>
                  <p className="text-lg font-black text-white font-mono">{pct(preview.taux)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-red-400 uppercase tracking-widest">{t('preview.tax_amount')}</p>
                  <p className="text-xl font-black text-red-400 font-mono leading-none">{fmt(preview.taxAmount)}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">{t('preview.net_amount')}</p>
                  <p className="text-2xl font-black text-emerald-400 font-mono leading-none">{fmt(preview.netAmount)}</p>
                </div>
              </div>
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Période Section */}
          <section className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-xl shadow-stone-200/50 dark:shadow-none space-y-6">
            <div className="flex items-center gap-3 border-b border-stone-100 dark:border-zinc-800 pb-5">
              <div className="p-2 bg-amber-500/10 rounded-xl">
                 <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-xs font-black text-stone-900 dark:text-white uppercase tracking-[0.2em]">{t('period.title')}</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('period.month_label')}</label>
                <select
                  className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 appearance-none text-center"
                  value={form.periodMonth}
                  onChange={(e) => setForm((f) => ({ ...f, periodMonth: e.target.value }))}
                >
                  {['01','02','03','04','05','06','07','08','09','10','11','12'].map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('period.year_label')}</label>
                <select
                  className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 appearance-none text-center"
                  value={form.periodYear}
                  onChange={(e) => setForm((f) => ({ ...f, periodYear: e.target.value }))}
                >
                  {Array.from({ length: 4 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Paiement Section */}
          <section className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-xl shadow-stone-200/50 dark:shadow-none space-y-6">
            <div className="flex items-center gap-3 border-b border-stone-100 dark:border-zinc-800 pb-5">
              <div className="p-2 bg-amber-500/10 rounded-xl">
                 <DollarSign className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <h2 className="text-xs font-black text-stone-900 dark:text-white uppercase tracking-[0.2em]">{t('payment.title')}</h2>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('payment.date_label')}</label>
                  <input
                    type="date"
                    className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 text-start"
                    value={form.paymentDate}
                    onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
                  />
                  {fieldError('paymentDate')}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('payment.method_label')}</label>
                  <select
                    className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-4 py-3 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 appearance-none text-center"
                    value={form.paymentMethod}
                    onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}
                  >
                    <option value="">—</option>
                    <option value="VIREMENT">{t('payment.methods.virement')}</option>
                    <option value="CHEQUE">{t('payment.methods.cheque')}</option>
                    <option value="ESPECE">{t('payment.methods.espece')}</option>
                  </select>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('payment.ref_label')}</label>
                <input
                  className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-3.5 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 shadow-inner text-start"
                  value={form.paymentReference}
                  onChange={(e) => setForm((f) => ({ ...f, paymentReference: e.target.value }))}
                  placeholder={t('payment.ref_placeholder')}
                />
              </div>
            </div>
          </section>
        </div>

        {/* Notes Section */}
        <section className="bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] p-8 shadow-xl shadow-stone-200/50 dark:shadow-none space-y-4">
          <label className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('notes.label')}</label>
          <textarea
            className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-2xl px-5 py-4 text-sm font-bold text-stone-900 dark:text-white outline-none focus:border-amber-500 transition-all resize-none shadow-inner text-start"
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder={t('notes.placeholder')}
          />
        </section>

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-5 rounded-2xl text-[11px] font-black uppercase tracking-widest flex items-center gap-4 animate-shake">
            <div className="p-2 bg-red-500/20 rounded-xl">
               <XCircle className="w-5 h-5 flex-shrink-0" />
            </div>
            {error}
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-center gap-4 pt-6">
          <button
            type="submit"
            disabled={loading}
            className="w-full sm:flex-[2] flex items-center justify-center gap-3 px-8 py-5 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-black text-sm shadow-xl shadow-amber-600/30 transition-all active:scale-95 disabled:opacity-50"
          >
            {loading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
            {loading ? t('submitting') : t('submit')}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="w-full sm:flex-1 px-8 py-5 bg-stone-100 dark:bg-zinc-800 border border-transparent hover:border-stone-200 dark:hover:border-zinc-700 text-stone-500 dark:text-zinc-500 hover:text-stone-900 dark:hover:text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
          >
            {t('cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
