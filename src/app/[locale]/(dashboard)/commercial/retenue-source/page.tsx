'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import {
  DollarSign, Plus, Download, Filter, RefreshCw,
  ChevronLeft, ChevronRight, CheckSquare, Square,
  AlertCircle, CheckCircle, Clock, XCircle, FileCode, Globe
} from 'lucide-react';
import { useSession } from '@/hooks/useSession'

export default function RetenueSourcePage() {
  const tc = useTranslations('Common.errors')
  const t = useTranslations('Commercial.RetenueSource');
  const locale = useLocale();
  const router = useRouter();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { tenantId } = useSession()
  const [periodYear, setPeriodYear] = useState(new Date().getFullYear());
  const [periodMonth, setPeriodMonth] = useState(new Date().getMonth() + 1);
  const [statusFilter, setStatusFilter] = useState('TOUT');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [resume, setResume] = useState<any>(null);

  const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
    DRAFT:      { label: t('status.DRAFT'),      color: 'bg-stone-100 text-stone-600',  icon: AlertCircle },
    EXPORTED:   { label: t('status.EXPORTED'),   color: 'bg-blue-100 text-blue-700',   icon: Clock },
    SUBMITTED:  { label: t('status.SUBMITTED'),  color: 'bg-amber-100 text-amber-700', icon: Clock },
    ACCEPTED:   { label: t('status.ACCEPTED'),   color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
    REJECTED:   { label: t('status.REJECTED'),   color: 'bg-red-100 text-red-600',     icon: XCircle },
    CANCELLED:  { label: t('status.CANCELLED'),  color: 'bg-stone-100 text-stone-400',  icon: XCircle },
  };

  const MONTHS = Array.from({ length: 12 }, (_, i) => {
    const date = new Date(2026, i, 1);
    return date.toLocaleString(locale === 'ar' ? 'ar-TN' : locale === 'en' ? 'en-US' : 'fr-FR', { month: 'long' });
  });

  useEffect(() => {
    const tid = tenantId;
  }, []);

  const tejIntent = useRef(typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('export') === 'tej');

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        tenantId,
        periodYear: String(periodYear),
        periodMonth: String(periodMonth),
        ...(statusFilter !== 'TOUT' && { tejStatus: statusFilter }),
      });
      const res = await fetch(`/api/commercial/retenue-source?${params}`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : [];
        setRecords(list);
        // Lien « Export TEJ » (?export=tej) : présélectionne les retenues exportables et amène au bouton d'export
        if (tejIntent.current) {
          tejIntent.current = false;
          setSelectedIds(list.filter((r: { tejStatus?: string }) => r.tejStatus === 'DRAFT' || r.tejStatus === 'EXPORTED').map((r: { id: string }) => r.id));
          setTimeout(() => document.getElementById('tej-export-btn')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const fetchResume = async () => {
    try {
      const { getRSResume } = await import('@/lib/tej-generator');
      const r = await getRSResume(tenantId, periodYear, periodMonth);
      setResume(r);
    } catch (e) { console.error(e); }
  };

  useEffect(() => {
    if (tenantId) {
      fetchRecords();
      fetchResume();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, periodYear, periodMonth, statusFilter]);

  const handleExport = async () => {
    if (selectedIds.length === 0) return;
    setExportLoading(true);
    try {
      const res = await fetch(`/api/commercial/retenue-source/export-tej`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          periodYear,
          periodMonth,
          withholdingTaxIds: selectedIds,
        }),
      });
      const result = await res.json();
      if (res.ok && result.xml) {
        const blob = new Blob([result.xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        a.click();
        fetchRecords();
        fetchResume();
      } else {
        alert(result.error || tc('export_failed'));
      }
    } catch (e) { alert(tc('connection_error')); }
    finally { setExportLoading(false); }
  };

  const toggleAll = () => {
    if (selectedIds.length === records.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(records.filter(r => r.tejStatus === 'DRAFT' || r.tejStatus === 'EXPORTED').map(r => r.id));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const fmt = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-TN' : 'fr-TN', { 
    style: 'currency', 
    currency: 'TND', 
    maximumFractionDigits: 3 
  });

  return (
    <div className="p-4 md:p-8 space-y-6 text-start">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-stone-900 dark:text-white tracking-tight flex items-center gap-3">
            <div className="p-3 bg-amber-500/10 rounded-2xl border border-amber-500/20">
              <DollarSign className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            {t('title')}
          </h1>
          <p className="text-stone-500 dark:text-zinc-500 font-medium mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/commercial/retenue-source/new"
            className="flex items-center gap-2 px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white rounded-2xl font-black text-sm shadow-xl shadow-amber-600/20 transition-all active:scale-95">
            <Plus className="w-4 h-4" /> {t('new')}
          </Link>
        </div>
      </div>

      {/* Period Selector + Resume */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-stone-200 dark:border-zinc-800 shadow-sm p-6 space-y-3 text-start">
          <p className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('year')}</p>
          <select value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))}
            className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-stone-900 dark:text-white transition-all focus:border-amber-500 outline-none appearance-none">
            {[2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="bg-white dark:bg-zinc-900 rounded-[2rem] border border-stone-200 dark:border-zinc-800 shadow-sm p-6 space-y-3 text-start">
          <p className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] ms-1">{t('month')}</p>
          <select value={periodMonth} onChange={e => setPeriodMonth(Number(e.target.value))}
            className="w-full bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 rounded-xl px-4 py-3 text-sm font-bold text-stone-900 dark:text-white transition-all focus:border-amber-500 outline-none appearance-none">
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div className="bg-teal-500/5 dark:bg-teal-500/10 border border-teal-500/10 dark:border-teal-500/20 rounded-[2rem] p-6 text-center transition-all hover:bg-teal-500/10">
          <p className="text-[10px] font-black text-teal-600 dark:text-teal-400 uppercase tracking-widest">{t('total_gross')}</p>
          <p className="text-2xl font-black text-teal-900 dark:text-teal-100 mt-1 font-mono">{fmt(resume?.totalGross || 0)}</p>
        </div>
        <div className="bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/10 dark:border-amber-500/20 rounded-[2rem] p-6 text-center transition-all hover:bg-amber-500/10">
          <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">{t('total_rs')}</p>
          <p className="text-2xl font-black text-amber-900 dark:text-amber-100 mt-1 font-mono">{fmt(resume?.totalRS || 0)}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-4 bg-white dark:bg-zinc-900 p-4 rounded-[2rem] border border-stone-200 dark:border-zinc-800 shadow-sm">
        <div className="flex items-center gap-2 overflow-x-auto pb-2 lg:pb-0 scrollbar-hide">
          <Filter className="w-4 h-4 text-stone-400 dark:text-zinc-500 flex-shrink-0" />
          <span className="text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-[0.2em] whitespace-nowrap ms-2 me-4">{t('status_filter')}</span>
          {['TOUT','DRAFT','EXPORTED','SUBMITTED','ACCEPTED','REJECTED'].map(s => (
            <button key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-2 rounded-xl text-xs font-black transition-all whitespace-nowrap ${statusFilter === s ? 'bg-stone-900 dark:bg-white text-white dark:text-stone-900 shadow-lg' : 'bg-stone-50 dark:bg-zinc-800 text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-700'}`}>
              {s === 'TOUT' ? t('status.TOUT') : t(`status.${s}`)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 ms-auto">
          <button onClick={toggleAll}
            className="flex items-center gap-2 px-4 py-2.5 bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-xl text-[10px] font-black uppercase tracking-widest text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-all">
            {selectedIds.length === records.length ? <CheckSquare className="w-4 h-4 text-teal-600 dark:text-teal-400" /> : <Square className="w-4 h-4 text-stone-400 dark:text-zinc-600" />}
            {t('select_all')}
          </button>
          <button id="tej-export-btn" onClick={handleExport} disabled={selectedIds.length === 0 || exportLoading}
            className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 disabled:opacity-30 text-white rounded-xl font-black text-sm shadow-xl shadow-teal-600/20 transition-all">
            <Download className="w-4 h-4" />
            {exportLoading ? t('export_loading') : t('export_xml', { count: selectedIds.length })}
          </button>
          <a href="https://www.tej.gov.tn" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 px-5 py-2.5 bg-stone-900 dark:bg-zinc-800 hover:bg-stone-800 dark:hover:bg-zinc-700 text-white rounded-xl font-black text-sm shadow-lg transition-all border border-stone-700 dark:border-zinc-700">
            <Globe className="w-4 h-4 text-amber-400" /> {t('declare_on_tej')}
          </a>
          <button onClick={fetchRecords}
            className="p-2.5 bg-stone-50 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 rounded-xl text-stone-500 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-700 transition-all">
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-white dark:bg-zinc-900 rounded-[2.5rem] border border-stone-200 dark:border-zinc-800 shadow-xl shadow-stone-200/50 dark:shadow-none overflow-hidden">
        {loading ? (
          <div className="p-24 text-center">
             <div className="w-16 h-16 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin mx-auto"></div>
             <p className="mt-4 text-stone-400 dark:text-zinc-500 font-bold uppercase tracking-widest text-[10px]">{t('loading')}</p>
          </div>
        ) : records.length === 0 ? (
          <div className="p-24 text-center">
            <div className="w-20 h-20 bg-stone-50 dark:bg-zinc-800 rounded-[2rem] flex items-center justify-center mx-auto mb-6 transform -rotate-12 transition-all hover:rotate-0">
               <DollarSign className="w-10 h-10 text-stone-300 dark:text-zinc-600" />
            </div>
            <p className="mt-3 font-black text-stone-400 dark:text-zinc-500 uppercase text-xs tracking-[0.2em]">{t('no_records')}</p>
            <Link href="/commercial/retenue-source/new"
              className="mt-6 inline-flex items-center gap-3 px-8 py-3.5 bg-amber-600 text-white rounded-2xl text-sm font-black shadow-xl shadow-amber-600/30 transition-all hover:bg-amber-500 active:scale-95">
              <Plus className="w-4 h-4" /> {t('create_first')}
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start border-collapse">
              <thead>
                <tr className="bg-stone-50/50 dark:bg-zinc-800/50 border-b border-stone-100 dark:border-zinc-800">
                  <th className="w-12 px-6 py-5"></th>
                  <th className="px-6 py-5 text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-widest text-start">{t('table.beneficiary')}</th>
                  <th className="px-6 py-5 text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-widest text-start">{t('table.type')}</th>
                  <th className="px-6 py-5 text-end text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-widest">{t('table.gross_ht')}</th>
                  <th className="px-6 py-5 text-center text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-widest">{t('table.rate')}</th>
                  <th className="px-6 py-5 text-end text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-widest">{t('table.tax_amount')}</th>
                  <th className="px-6 py-5 text-end text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-widest">{t('table.net_amount')}</th>
                  <th className="px-6 py-5 text-center text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-widest">{t('table.status')}</th>
                  <th className="px-6 py-5 text-[10px] font-black text-stone-400 dark:text-zinc-500 uppercase tracking-widest text-end">{t('table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50 dark:divide-zinc-800/50">
                {records.map((r: any) => {
                  const cfg = STATUS_CONFIG[r.tejStatus] || STATUS_CONFIG.DRAFT;
                  const Icon = cfg.icon;
                  const selectable = r.tejStatus === 'DRAFT' || r.tejStatus === 'EXPORTED';
                  return (
                    <tr key={r.id} className="hover:bg-amber-500/[0.02] dark:hover:bg-amber-500/[0.05] transition-colors group">
                      <td className="px-6 py-6 text-center">
                        {selectable ? (
                          <button onClick={() => toggleOne(r.id)} className="transition-all hover:scale-110">
                            {selectedIds.includes(r.id) ? 
                              <CheckSquare className="w-5 h-5 text-teal-600 dark:text-teal-400" /> : 
                              <Square className="w-5 h-5 text-stone-300 dark:text-zinc-700" />
                            }
                          </button>
                        ) : (
                          <CheckCircle className="w-5 h-5 text-stone-200 dark:text-zinc-800" />
                        )}
                      </td>
                      <td className="px-6 py-6">
                        <p className="text-sm font-black text-stone-900 dark:text-white tracking-tight leading-tight">{r.beneficiaryName}</p>
                        <p className="text-[10px] text-stone-400 dark:text-zinc-500 font-bold font-mono tracking-widest mt-1 uppercase">{r.beneficiaryTin || '—'}</p>
                      </td>
                      <td className="px-6 py-6">
                        <span className={`text-[10px] font-black px-3 py-1.5 rounded-xl tracking-widest uppercase border ${
                          r.beneficiaryType === 'SOCIETE' 
                            ? 'bg-blue-500/5 text-blue-600 border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/30' 
                            : 'bg-purple-500/5 text-purple-600 border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/30'
                        }`}>
                          {t(`beneficiary.type_${r.beneficiaryType.toLowerCase()}`)}
                        </span>
                      </td>
                      <td className="px-6 py-6 text-end">
                        <p className="text-sm font-bold text-stone-600 dark:text-zinc-400 font-mono">{fmt(Number(r.grossAmount))}</p>
                      </td>
                      <td className="px-6 py-6 text-center">
                        <p className="text-xs font-black text-stone-400 dark:text-zinc-500 font-mono bg-stone-50 dark:bg-zinc-800 px-2 py-1 rounded-lg inline-block">
                          {(Number(r.rate)*100).toFixed(1)}%
                        </p>
                      </td>
                      <td className="px-6 py-6 text-end">
                        <p className="text-sm font-black text-amber-600 dark:text-amber-400 font-mono">{fmt(Number(r.taxAmount))}</p>
                      </td>
                      <td className="px-6 py-6 text-end">
                        <p className="text-base font-black text-stone-900 dark:text-white font-mono">{fmt(Number(r.netAmount))}</p>
                      </td>
                      <td className="px-6 py-6 text-center">
                        <span className={`inline-flex items-center gap-1.5 text-[9px] font-black px-3 py-1.5 rounded-xl uppercase tracking-[0.15em] border ${
                           r.tejStatus === 'ACCEPTED' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
                           r.tejStatus === 'REJECTED' ? 'bg-red-500/10 text-red-600 border-red-500/20' :
                           r.tejStatus === 'SUBMITTED' ? 'bg-amber-500/10 text-amber-600 border-amber-500/20' :
                           r.tejStatus === 'EXPORTED' ? 'bg-blue-500/10 text-blue-600 border-blue-500/20' :
                           'bg-stone-500/10 text-stone-600 border-stone-500/20'
                        }`}>
                          <Icon className="w-3 h-3" />{cfg.label}
                        </span>
                      </td>
                      <td className="px-6 py-6 text-end">
                        <Link href={`/commercial/retenue-source/${r.id}`}
                          className="inline-flex items-center gap-2 group/btn px-4 py-2 bg-stone-50 dark:bg-zinc-800 hover:bg-stone-900 dark:hover:bg-white text-stone-400 hover:text-white dark:text-zinc-500 dark:hover:text-stone-900 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all">
                          {t('table.view_edit')}
                          <ChevronRight className="w-3 h-3 transition-transform group-hover/btn:translate-x-1 rtl:group-hover/btn:-translate-x-1" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
