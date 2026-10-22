"use client";

import { useState, useEffect, useCallback } from "react";
import { PayrollSummary } from "./components/PayrollSummary";
import { PaySlipTable } from "./components/PaySlipTable";
import { PaySlipModal } from "./components/PaySlipModal";
import { PaieParametersModal } from "./components/PaieParametersModal";
import { DollarSign, FileText, Users, Settings, Plus } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { useTranslations } from 'next-intl'
import { apiErrorMessage } from "@/lib/zod-helpers";

const MONTHS = [
  { value: 1 },
  { value: 2 },
  { value: 3 },
  { value: 4 },
  { value: 5 },
  { value: 6 },
  { value: 7 },
  { value: 8 },
  { value: 9 },
  { value: 10 },
  { value: 11 },
  { value: 12 },
];

export default function PaiePage() {
  const t = useTranslations('HR.payroll')
  const tm = useTranslations('Commercial.months')
  const tp = useTranslations('HR.payroll.params')
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const { tenantId } = useSession();
  const [summary, setSummary] = useState<any>(null);
  const [payslips, setPayslips] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPayslip, setSelectedPayslip] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showParams, setShowParams] = useState(false);
  const [posting, setPosting] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchPayrollData = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setError("");
    try {
      // mois/année toujours transmis (l'API exige une période ; mois en cours par défaut)
      const qs = new URLSearchParams({ tenantId, month: String(selectedMonth), year: String(selectedYear) });
      const [summaryRes, payslipsRes] = await Promise.all([
        fetch(`/api/hr/payroll?${qs}`),
        fetch(`/api/hr/payslips?${qs}`),
      ]);
      const summaryData = await summaryRes.json().catch(() => null);
      const payslipsData = await payslipsRes.json().catch(() => null);
      if (!summaryRes.ok) {
        setSummary(null);
        setError(apiErrorMessage(summaryData, t("load_error")));
      } else {
        setSummary(summaryData && typeof summaryData === "object" ? summaryData : null);
      }
      setPayslips(Array.isArray(payslipsData) ? payslipsData : []);
    } catch (err) {
      console.error("Error fetching payroll data:", err);
      setError(t("load_error"));
    } finally {
      setLoading(false);
    }
  }, [tenantId, selectedMonth, selectedYear, t]);

  useEffect(() => {
    const id = setTimeout(() => { void fetchPayrollData(); }, 0);
    return () => clearTimeout(id);
  }, [fetchPayrollData]);

  async function handleGeneratePayslips() {
    setError("");
    setNotice("");
    const employeeIds: string[] = Array.isArray(summary?.employeeIds) ? summary.employeeIds : [];
    if (!employeeIds.length) {
      setError(t("no_employees"));
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/hr/payslips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeIds,
          month: selectedMonth,
          year: selectedYear,
          tenantId,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(apiErrorMessage(data, t("generate_error")));
      } else {
        await fetchPayrollData();
        // Employés ignorés (sans salaire, bulletin déjà payé/comptabilisé…) : message explicite
        const skipped = Array.isArray(data?.skipped) ? data.skipped : [];
        const parts = [
          data?.generated ? `${data.generated} bulletin(s) généré(s)` : "",
          data?.updated ? `${data.updated} bulletin(s) brouillon recalculé(s)` : "",
          skipped.length ? `ignorés : ${skipped.map((s: { employee: string; reason: string }) => `${s.employee} (${s.reason})`).join(", ")}` : "",
        ].filter(Boolean);
        if (parts.length) setNotice(parts.join(" — "));
      }
    } catch (err) {
      console.error("Error generating payslips:", err);
      setError(t("generate_error"));
    } finally {
      setGenerating(false);
    }
  }

  // Centralisation comptable de la période (écriture OD équilibrée 640/647 → 453/432/425)
  async function handlePostToAccounting() {
    setError("");
    setNotice("");
    setPosting(true);
    try {
      const res = await fetch("/api/hr/payroll/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: selectedMonth, year: selectedYear, tenantId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(apiErrorMessage(data, t("post_error")));
      } else {
        setNotice(t("post_success", { number: data?.entryNumber ?? "" }));
        await fetchPayrollData();
      }
    } catch {
      setError(t("post_error"));
    } finally {
      setPosting(false);
    }
  }

  function handleViewPayslip(payslip: any) {
    setSelectedPayslip(payslip);
    setShowModal(true);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <p className="text-gray-500">{t('subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowParams(true)}
            disabled={!tenantId}
            className="disabled:opacity-50 flex items-center gap-2 px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg"
          >
            <Settings className="w-4 h-4" />
            {t('settings')}
          </button>
          <button
            onClick={handlePostToAccounting}
            disabled={posting || loading || !payslips.some((p) => p.statut === "PENDING" && !p.accountingEntryId)}
            className="disabled:opacity-50 flex items-center gap-2 px-4 py-2 text-sm bg-white border hover:bg-gray-50 rounded-lg"
          >
            <FileText className="w-4 h-4" />
            {t('post')}
          </button>
          <button
            onClick={handleGeneratePayslips}
            disabled={generating || loading}
            className="disabled:opacity-50 flex items-center gap-2 px-4 py-2 text-sm bg-teal-600 hover:bg-teal-700 text-white rounded-lg"
          >
            <Plus className="w-4 h-4" />
            {t('generate')}
          </button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex items-center gap-4 p-4 bg-white rounded-xl border">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">{t('period')}</label>
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>{tm(String(m.value))}</option>
            ))}
          </select>
          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(parseInt(e.target.value))}
            className="px-3 py-2 border rounded-lg text-sm"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-yellow-400" />
            <span className="text-gray-600">{t('draft_count', { count: summary?.statusBreakdown?.draft || 0 })}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gray-400" />
            <span className="text-gray-600">{t('cancelled_count', { count: summary?.statusBreakdown?.cancelled || 0 })}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-green-400" />
            <span className="text-gray-600">{t('paid_count', { count: summary?.statusBreakdown?.paid || 0 })}</span>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm font-medium">
          {error}
        </div>
      )}

      {notice && !error && (
        <div role="status" className="p-4 rounded-xl border border-teal-200 bg-teal-50 text-teal-800 text-sm">
          {notice}
        </div>
      )}

      {/* Summary Cards */}
      {summary && <PayrollSummary summary={summary} />}

      {!loading && !error && payslips.length === 0 && (
        <div className="p-6 rounded-xl border border-dashed text-center text-sm text-gray-500">
          {t("empty_period")}
        </div>
      )}

      {/* Payslips Table */}
      <div className="bg-white rounded-xl border">
        <div className="p-4 border-b">
          <h2 className="font-semibold text-gray-900">{t('payslips')}</h2>
        </div>
        <PaySlipTable
          payslips={payslips}
          loading={loading}
          onViewPayslip={handleViewPayslip}
        />
      </div>

      {showParams && tenantId && (
        <PaieParametersModal
          tenantId={tenantId}
          onClose={() => setShowParams(false)}
          onSaved={() => {
            setShowParams(false);
            setNotice(tp("saved"));
          }}
        />
      )}

      {/* PaySlip Modal */}
      {showModal && selectedPayslip && (
        <PaySlipModal
          payslip={selectedPayslip}
          onUpdated={() => { void fetchPayrollData(); }}
          onClose={() => {
            setShowModal(false);
            setSelectedPayslip(null);
          }}
        />
      )}
    </div>
  );
}