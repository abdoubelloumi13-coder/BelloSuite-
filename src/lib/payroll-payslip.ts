/**
 * Passerelle entre le moteur de paie pur (lib/payroll) et les enregistrements Prisma :
 * - construction des données d'un bulletin (PaySlip) à partir d'un employé + paramètres ;
 * - écriture comptable de centralisation de paie équilibrée ;
 * - traduction en français des erreurs base de données rencontrées pendant la génération.
 * Aucune dépendance à Prisma ici (testable sans base).
 */
import { computePayslip, roundMillime, type PayrollParams, type PayslipComputation } from '@/lib/payroll'

const MONTH_CODES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export interface PayrollEmployee {
  employeeNumber: string
  salary: unknown
  situationFamiliale?: string | null
  enfantsCharge?: number | null
}

/** Éléments variables déjà saisis sur un bulletin existant (conservés lors d'un recalcul). */
export interface PayslipVariables {
  heuresSupQte?: unknown
  heuresSupMontant?: unknown
  primeAnciennete?: unknown
  primeTransport?: unknown
  primePanier?: unknown
  autresPrimes?: unknown
  deductionAbsences?: unknown
  deductionRetards?: unknown
  autresDeductions?: unknown
  joursTravailles?: unknown
}

const n = (v: unknown) => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}

export function payslipReference(month: number, year: number, employeeNumber: string): string {
  return `${MONTH_CODES[month - 1] ?? String(month).padStart(2, '0')}-${year}-${employeeNumber}`
}

export function isHeadOfFamily(e: Pick<PayrollEmployee, 'situationFamiliale'>): boolean {
  return e.situationFamiliale === 'CHEF_FAMILLE'
}

/** Calcul d'un bulletin pour un employé (variables existantes conservées). */
export function computeEmployeePayslip(employee: PayrollEmployee, params: PayrollParams, vars: PayslipVariables = {}): PayslipComputation {
  return computePayslip({
    baseSalary: n(employee.salary),
    overtimeAmount: n(vars.heuresSupMontant),
    seniorityBonus: n(vars.primeAnciennete),
    transportBonus: n(vars.primeTransport),
    mealBonus: n(vars.primePanier),
    otherBonuses: n(vars.autresPrimes),
    absenceDeduction: n(vars.deductionAbsences),
    delayDeduction: n(vars.deductionRetards),
    otherDeductions: n(vars.autresDeductions),
    isHeadOfFamily: isHeadOfFamily(employee),
    childrenCount: n(employee.enfantsCharge),
  }, params)
}

/**
 * Colonnes PaySlip issues du calcul. Les anciennes ventilations (CNRPS, CNAVIS, AMO) sont mises à 0 :
 * la CNSS 2026 (9,68 %) est portée entièrement par cnssSalaire. totalCotisations = CNSS salariale.
 * salaireImposable = brut − CNSS (mensuel, avant frais pro et déductions annuelles).
 */
export function payslipAmounts(employee: PayrollEmployee, c: PayslipComputation, vars: PayslipVariables = {}) {
  return {
    salaireBase: roundMillime(n(employee.salary)),
    heuresSupQte: n(vars.heuresSupQte),
    heuresSupMontant: roundMillime(n(vars.heuresSupMontant)),
    primeAnciennete: roundMillime(n(vars.primeAnciennete)),
    primeTransport: roundMillime(n(vars.primeTransport)),
    primePanier: roundMillime(n(vars.primePanier)),
    autresPrimes: roundMillime(n(vars.autresPrimes)),
    deductionAbsences: roundMillime(n(vars.deductionAbsences)),
    deductionRetards: roundMillime(n(vars.deductionRetards)),
    autresDeductions: c.otherDeductions,
    brutGlobal: c.grossSalary,
    cnrpsSalaire: 0,
    cnssSalaire: c.cnssEmployee,
    cnavisSalaire: 0,
    amoSalaire: 0,
    totalCotisations: c.cnssEmployee,
    salaireImposable: c.taxableMonthly,
    deductionChefFam: c.headOfFamilyDeduction,
    deductionEnfants: c.childrenDeduction,
    irpp: c.irpp,
    css: c.css,
    cnssPatronal: c.cnssEmployer,
    netAPayer: c.netSalary,
  }
}

// ─── Centralisation comptable ──────────────────────────────────────

export interface PayslipForAccounting {
  brutGlobal: unknown
  cnssSalaire: unknown
  irpp: unknown
  css?: unknown
  cnssPatronal?: unknown
  netAPayer: unknown
  autresDeductions?: unknown
}

export interface PayrollJournalLine {
  account: '640' | '647' | '453' | '432' | '425'
  debit: number
  credit: number
  label: string
}

export class PayrollBalanceError extends Error {}

/**
 * Écriture de paie (plan comptable tunisien) :
 *   D 640 Salaires bruts          D 647 Charges sociales patronales (CNSS)
 *   C 453 CNSS (salariale + patronale)   C 432 Retenues à la source (IRPP + CSS)   C 425 Rémunérations dues
 * 425 = brut − CNSS salariale − IRPP − CSS (net à payer + autres retenues éventuelles, ex. avances).
 * Lève PayrollBalanceError si débit ≠ crédit (au millime près).
 * `cnssEmployerRate` sert de repli pour les bulletins antérieurs sans cnssPatronal enregistré.
 */
export function buildPayrollJournalLines(payslips: PayslipForAccounting[], period: string, cnssEmployerRate = 17.07): PayrollJournalLine[] {
  let gross = 0, cnssSal = 0, cnssPat = 0, irpp = 0, css = 0
  for (const p of payslips) {
    const g = n(p.brutGlobal)
    gross += g
    cnssSal += n(p.cnssSalaire)
    const pat = n(p.cnssPatronal)
    cnssPat += pat > 0 ? pat : roundMillime(g * cnssEmployerRate / 100)
    irpp += n(p.irpp)
    css += n(p.css)
  }
  gross = roundMillime(gross); cnssSal = roundMillime(cnssSal); cnssPat = roundMillime(cnssPat)
  irpp = roundMillime(irpp); css = roundMillime(css)
  const due = roundMillime(gross - cnssSal - irpp - css)
  if (due < 0) throw new PayrollBalanceError(`Paie ${period} : retenues supérieures au brut (contrôlez les bulletins)`)

  const lines: PayrollJournalLine[] = [
    { account: '640', debit: gross, credit: 0, label: `Salaires bruts ${period}` },
    { account: '647', debit: cnssPat, credit: 0, label: `CNSS patronale ${period}` },
    { account: '453', debit: 0, credit: roundMillime(cnssSal + cnssPat), label: `CNSS salariale + patronale ${period}` },
    { account: '432', debit: 0, credit: roundMillime(irpp + css), label: `IRPP + CSS retenus ${period}` },
    { account: '425', debit: 0, credit: due, label: `Rémunérations dues ${period}` },
  ].filter(l => l.debit > 0 || l.credit > 0) as PayrollJournalLine[]

  assertBalanced(lines.map(l => ({ debit: l.debit, credit: l.credit })), `Écriture de paie ${period}`)
  return lines
}

/** Contrôle d'équilibre débit = crédit (tolérance 0,0005 DT). */
export function assertBalanced(lines: { debit: unknown; credit: unknown }[], what = 'Écriture'): void {
  const d = roundMillime(lines.reduce((s, l) => s + n(l.debit), 0))
  const c = roundMillime(lines.reduce((s, l) => s + n(l.credit), 0))
  if (Math.abs(d - c) > 0.0005) {
    throw new PayrollBalanceError(`${what} déséquilibrée : débit ${d.toFixed(3)} DT ≠ crédit ${c.toFixed(3)} DT`)
  }
  if (d <= 0) throw new PayrollBalanceError(`${what} vide (montant nul)`)
}

// ─── Erreurs base de données → messages français ───────────────────

const MIGRATION_HINT = 'exécutez la migration Supabase 20261022000300_paie_2026.sql'

/**
 * Message français pour une erreur rencontrée pendant la génération/mise à jour de la paie.
 * Reconnaît les codes Prisma (P2002, P2011, P2021, P2022, P2003) et les codes PostgreSQL (23502, 42703, 42P01).
 */
export function payrollErrorMessage(err: unknown, context = 'Génération des bulletins impossible'): string {
  const e = (err ?? {}) as { code?: string; message?: string; meta?: Record<string, unknown> }
  const msg = String(e.message ?? '')
  const meta = e.meta ?? {}
  const pgCode = /\b(23502|42703|42P01|23505)\b/.exec(msg)?.[1]
  const code = e.code ?? pgCode
  const detail = (k: string) => (meta[k] !== undefined ? String(meta[k]) : '')

  switch (code) {
    case 'P2021':
    case '42P01':
      return `${context} : table de paie absente de la base (${detail('table') || 'PaieParameters / PaySlip'}) — ${MIGRATION_HINT}.`
    case 'P2022':
    case '42703': {
      const col = detail('column') || /column "?([\w.]+)"? does not exist/i.exec(msg)?.[1] || ''
      return `${context} : base de données non à jour${col ? ` (colonne ${col} manquante)` : ''} — ${MIGRATION_HINT}.`
    }
    case 'P2011':
    case '23502': {
      const col = detail('constraint') || /column "?([\w]+)"?/i.exec(msg)?.[1] || ''
      return `${context} : une ancienne colonne obligatoire de la table des bulletins${col ? ` (${col})` : ''} bloque l'enregistrement — ${MIGRATION_HINT}.`
    }
    case 'P2002':
    case '23505':
      return `${context} : un bulletin portant la même référence existe déjà pour cette période.`
    case 'P2003':
      return `${context} : employé ou société introuvable (référence invalide).`
    default:
      if (err instanceof Error && err.name === 'PayrollInputError') return `${context} : ${err.message}.`
      return `${context} : erreur inattendue du serveur. Réessayez ; si le problème persiste, contactez le support.`
  }
}
