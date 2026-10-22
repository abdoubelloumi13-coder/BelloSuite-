"use client";

import { useEffect, useState } from "react";
import { X, Save, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { apiErrorMessage } from "@/lib/zod-helpers";
import { DEFAULT_PAYROLL_PARAMS_2026 } from "@/lib/payroll";

/** Paramètres de paie modifiables depuis l'écran Paie (défauts 2026 : CNSS 9,68 / 17,07 %, SMIG 554,736 DT / 2,667 DT/h). */
const FIELDS: { key: string; step: string; fallback: number }[] = [
  { key: "tauxCnssSalarial", step: "0.01", fallback: DEFAULT_PAYROLL_PARAMS_2026.cnssEmployeeRate },
  { key: "tauxCnssPatronal", step: "0.01", fallback: DEFAULT_PAYROLL_PARAMS_2026.cnssEmployerRate },
  { key: "smigMensuel", step: "0.001", fallback: DEFAULT_PAYROLL_PARAMS_2026.smigMonthly },
  { key: "smigHoraire", step: "0.001", fallback: DEFAULT_PAYROLL_PARAMS_2026.smigHourly },
  { key: "deductionChefFamille", step: "0.001", fallback: DEFAULT_PAYROLL_PARAMS_2026.headOfFamilyDeduction },
  { key: "deductionParEnfant", step: "0.001", fallback: DEFAULT_PAYROLL_PARAMS_2026.childDeduction },
  { key: "enfantsMaxDeductible", step: "1", fallback: DEFAULT_PAYROLL_PARAMS_2026.maxChildren },
  { key: "fraisProTaux", step: "0.01", fallback: DEFAULT_PAYROLL_PARAMS_2026.professionalExpensesRate },
  { key: "fraisProPlafond", step: "0.001", fallback: DEFAULT_PAYROLL_PARAMS_2026.professionalExpensesCap },
  { key: "cssTaux", step: "0.01", fallback: DEFAULT_PAYROLL_PARAMS_2026.cssRate },
  { key: "cssSeuilExoneration", step: "0.001", fallback: DEFAULT_PAYROLL_PARAMS_2026.cssExemptionThreshold },
];

export function PaieParametersModal({ tenantId, onClose, onSaved }: { tenantId: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("HR.payroll.params");
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/hr/paie-parameters?tenantId=${encodeURIComponent(tenantId)}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!alive) return;
        if (!r.ok) setError(apiErrorMessage(data, t("load_error")));
        const v: Record<string, string> = {};
        for (const f of FIELDS) {
          const raw = data && typeof data === "object" ? (data as Record<string, unknown>)[f.key] : undefined;
          v[f.key] = raw !== undefined && raw !== null ? String(Number(raw)) : String(f.fallback);
        }
        setValues(v);
      })
      .catch(() => alive && setError(t("load_error")))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [tenantId, t]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/hr/paie-parameters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, ...values }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(apiErrorMessage(data, t("save_error")));
        return;
      }
      onSaved();
    } catch {
      setError(t("save_error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <form onSubmit={handleSave} className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{t("title")}</h2>
            <p className="text-xs text-gray-500">{t("subtitle")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("cancel")} className="p-2 rounded-full hover:bg-gray-100"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-4">
          {error && <div role="alert" className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-teal-600" /></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {FIELDS.map((f) => (
                <label key={f.key} className="space-y-1 text-sm">
                  <span className="font-medium text-gray-700">{t(`fields.${f.key}`)}</span>
                  <input
                    type="number"
                    min={0}
                    step={f.step}
                    value={values[f.key] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400">{t("disclaimer")}</p>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-gray-100 hover:bg-gray-200">{t("cancel")}</button>
          <button type="submit" disabled={saving || loading} className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{t("save")}
          </button>
        </div>
      </form>
    </div>
  );
}
