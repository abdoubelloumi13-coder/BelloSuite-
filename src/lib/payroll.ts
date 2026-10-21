/**
 * Moteur de paie tunisien (fonctions pures, sans accès base) — règles 2026.
 *
 * - CNSS (régime général) : salarié 9,18 % + 0,5 % perte d'emploi = 9,68 % ; patronal 16,57 % + 0,5 % = 17,07 %.
 *   Taux PARAMÉTRABLES (PaieParameters.tauxCnssSalarial / tauxCnssPatronal) — à valider par un comptable.
 * - IRPP : barème annuel LF 2025 (art. 44 CIRPPIS) appliqué au revenu annualisé, puis ramené au mois (/12).
 * - Frais professionnels : 10 % du brut imposable (brut − CNSS), plafonnés à 2 000 DT/an.
 * - Déductions pour charges de famille : chef de famille 300 DT/an, 100 DT/an par enfant à charge (4 au plus).
 * - CSS (contribution sociale de solidarité) : 0,5 % du revenu imposable annuel, exonérée si ce revenu ≤ 5 000 DT.
 * - Arrondi au millime à chaque montant restitué.
 */

export interface IrppBracket {
  /** Borne haute annuelle de la tranche (DT) ; null = dernière tranche, sans plafond */
  upTo: number | null
  /** Taux de la tranche en % */
  rate: number
}

export interface PayrollParams {
  /** CNSS salariale totale en % du brut (défaut 9,68) */
  cnssEmployeeRate: number
  /** CNSS patronale totale en % du brut (défaut 17,07) */
  cnssEmployerRate: number
  irppBrackets: IrppBracket[]
  /** Frais professionnels en % du brut imposable (défaut 10) */
  professionalExpensesRate: number
  /** Plafond annuel des frais professionnels (défaut 2 000 DT) */
  professionalExpensesCap: number
  /** Déduction annuelle chef de famille (défaut 300 DT) */
  headOfFamilyDeduction: number
  /** Déduction annuelle par enfant à charge (défaut 100 DT) */
  childDeduction: number
  /** Nombre maximal d'enfants ouvrant droit à déduction (défaut 4) */
  maxChildren: number
  /** CSS en % du revenu imposable annuel (défaut 0,5) */
  cssRate: number
  /** Revenu imposable annuel en deçà duquel (inclus) la CSS n'est pas due (défaut 5 000 DT) */
  cssExemptionThreshold: number
  /** SMIG mensuel régime 48 h (défaut 2026 : 554,736 DT) */
  smigMonthly: number
  /** SMIG horaire régime 48 h (défaut 2026 : 2,667 DT) */
  smigHourly: number
}

/** Barème IRPP annuel LF 2025 (en vigueur en 2026). */
export const IRPP_BRACKETS_LF2025: IrppBracket[] = [
  { upTo: 5000, rate: 0 },
  { upTo: 10000, rate: 15 },
  { upTo: 20000, rate: 25 },
  { upTo: 30000, rate: 30 },
  { upTo: 40000, rate: 33 },
  { upTo: 50000, rate: 36 },
  { upTo: 70000, rate: 38 },
  { upTo: null, rate: 40 },
]

/** Paramètres par défaut 2026 — à valider par un comptable avant usage en production. */
export const DEFAULT_PAYROLL_PARAMS_2026: PayrollParams = {
  cnssEmployeeRate: 9.68,
  cnssEmployerRate: 17.07,
  irppBrackets: IRPP_BRACKETS_LF2025,
  professionalExpensesRate: 10,
  professionalExpensesCap: 2000,
  headOfFamilyDeduction: 300,
  childDeduction: 100,
  maxChildren: 4,
  cssRate: 0.5,
  cssExemptionThreshold: 5000,
  smigMonthly: 554.736,
  smigHourly: 2.667,
}

/** Arrondi au millime (3 décimales), robuste aux erreurs binaires (1.0005 → 1.001). */
export function roundMillime(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON * Math.sign(n)) * 1000) / 1000
}

const num = (v: unknown, fallback: number): number => {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** IRPP annuel par tranches. */
export function computeAnnualIrpp(annualBase: number, brackets: IrppBracket[] = IRPP_BRACKETS_LF2025): number {
  if (!(annualBase > 0)) return 0
  let tax = 0
  let prev = 0
  for (const b of brackets) {
    const top = b.upTo === null ? Infinity : b.upTo
    if (annualBase <= prev) break
    tax += (Math.min(annualBase, top) - prev) * (b.rate / 100)
    prev = top
  }
  return tax
}

/**
 * Paramètres de paie à partir d'un enregistrement PaieParameters (Prisma, Decimal acceptés).
 * Champs absents → valeurs 2026 par défaut. Le barème à 8 tranches n'est lu que si toutes ses colonnes existent.
 */
export function payrollParamsFromRecord(rec: Record<string, unknown> | null | undefined): PayrollParams {
  const d = DEFAULT_PAYROLL_PARAMS_2026
  if (!rec) return { ...d, irppBrackets: [...d.irppBrackets] }
  let irppBrackets = d.irppBrackets
  const maxKeys = ['irppTranche1Max', 'irppTranche2Max', 'irppTranche3Max', 'irppTranche4Max', 'irppTranche5Max', 'irppTranche6Max', 'irppTranche7Max']
  const rateKeys = ['irppTaux1', 'irppTaux2', 'irppTaux3', 'irppTaux4', 'irppTaux5', 'irppTaux6', 'irppTaux7', 'irppTaux8']
  if ([...maxKeys, ...rateKeys].every(k => rec[k] !== undefined && rec[k] !== null)) {
    const maxes = maxKeys.map(k => Number(rec[k]))
    const rates = rateKeys.map(k => Number(rec[k]))
    const increasing = maxes.every((m, i) => Number.isFinite(m) && m > 0 && (i === 0 || m > maxes[i - 1]))
    if (increasing && rates.every(r => Number.isFinite(r) && r >= 0 && r <= 100)) {
      irppBrackets = [...maxes.map((m, i) => ({ upTo: m, rate: rates[i] })), { upTo: null, rate: rates[7] }]
    }
  }
  return {
    cnssEmployeeRate: num(rec.tauxCnssSalarial, d.cnssEmployeeRate),
    cnssEmployerRate: num(rec.tauxCnssPatronal, d.cnssEmployerRate),
    irppBrackets,
    professionalExpensesRate: num(rec.fraisProTaux, d.professionalExpensesRate),
    professionalExpensesCap: num(rec.fraisProPlafond, d.professionalExpensesCap),
    headOfFamilyDeduction: num(rec.deductionChefFamille, d.headOfFamilyDeduction),
    childDeduction: num(rec.deductionParEnfant, d.childDeduction),
    maxChildren: Math.max(0, Math.floor(num(rec.enfantsMaxDeductible, d.maxChildren))),
    cssRate: num(rec.cssTaux, d.cssRate),
    cssExemptionThreshold: num(rec.cssSeuilExoneration, d.cssExemptionThreshold),
    smigMonthly: num(rec.smigMensuel, d.smigMonthly),
    smigHourly: num(rec.smigHoraire, d.smigHourly),
  }
}

export interface PayslipInput {
  /** Salaire de base mensuel brut (DT) */
  baseSalary: number
  overtimeAmount?: number
  seniorityBonus?: number
  transportBonus?: number
  mealBonus?: number
  otherBonuses?: number
  /** Retenues pour absences / retards (réduisent le brut cotisable) */
  absenceDeduction?: number
  delayDeduction?: number
  /** Autres retenues sur le net (avances, oppositions…) */
  otherDeductions?: number
  isHeadOfFamily: boolean
  childrenCount: number
}

export interface PayslipComputation {
  grossSalary: number
  cnssEmployee: number
  cnssEmployer: number
  /** Brut imposable mensuel = brut − CNSS salariale */
  taxableMonthly: number
  annualTaxable: number
  annualProfessionalExpenses: number
  annualHeadOfFamilyDeduction: number
  annualChildrenDeduction: number
  annualTaxBase: number
  annualIrpp: number
  annualCss: number
  /** Équivalents mensuels (pour le bulletin) */
  headOfFamilyDeduction: number
  childrenDeduction: number
  irpp: number
  css: number
  otherDeductions: number
  totalEmployeeDeductions: number
  netSalary: number
  /** Coût employeur = brut + CNSS patronale */
  employerCost: number
}

export class PayrollInputError extends Error {}

/** Calcul complet d'un bulletin mensuel. */
export function computePayslip(input: PayslipInput, params: PayrollParams = DEFAULT_PAYROLL_PARAMS_2026): PayslipComputation {
  const base = Number(input.baseSalary)
  if (!Number.isFinite(base) || base < 0) throw new PayrollInputError('Salaire de base invalide')
  const v = (x: number | undefined) => {
    const n = Number(x ?? 0)
    return Number.isFinite(n) ? n : 0
  }
  const grossSalary = roundMillime(Math.max(0,
    base + v(input.overtimeAmount) + v(input.seniorityBonus) + v(input.transportBonus) + v(input.mealBonus) + v(input.otherBonuses)
    - v(input.absenceDeduction) - v(input.delayDeduction),
  ))

  const cnssEmployee = roundMillime(grossSalary * params.cnssEmployeeRate / 100)
  const cnssEmployer = roundMillime(grossSalary * params.cnssEmployerRate / 100)
  const taxableMonthly = roundMillime(grossSalary - cnssEmployee)

  const annualTaxable = taxableMonthly * 12
  const annualProfessionalExpenses = Math.min(annualTaxable * params.professionalExpensesRate / 100, params.professionalExpensesCap)
  const annualHeadOfFamilyDeduction = input.isHeadOfFamily ? params.headOfFamilyDeduction : 0
  const children = Math.max(0, Math.floor(Number(input.childrenCount) || 0))
  const annualChildrenDeduction = Math.min(children, params.maxChildren) * params.childDeduction
  const annualTaxBase = Math.max(0, annualTaxable - annualProfessionalExpenses - annualHeadOfFamilyDeduction - annualChildrenDeduction)

  const annualIrpp = computeAnnualIrpp(annualTaxBase, params.irppBrackets)
  const annualCss = annualTaxBase > params.cssExemptionThreshold ? annualTaxBase * params.cssRate / 100 : 0

  const irpp = roundMillime(annualIrpp / 12)
  const css = roundMillime(annualCss / 12)
  const otherDeductions = roundMillime(Math.max(0, v(input.otherDeductions)))
  const totalEmployeeDeductions = roundMillime(cnssEmployee + irpp + css + otherDeductions)

  return {
    grossSalary,
    cnssEmployee,
    cnssEmployer,
    taxableMonthly,
    annualTaxable: roundMillime(annualTaxable),
    annualProfessionalExpenses: roundMillime(annualProfessionalExpenses),
    annualHeadOfFamilyDeduction: roundMillime(annualHeadOfFamilyDeduction),
    annualChildrenDeduction: roundMillime(annualChildrenDeduction),
    annualTaxBase: roundMillime(annualTaxBase),
    annualIrpp: roundMillime(annualIrpp),
    annualCss: roundMillime(annualCss),
    headOfFamilyDeduction: roundMillime(annualHeadOfFamilyDeduction / 12),
    childrenDeduction: roundMillime(annualChildrenDeduction / 12),
    irpp,
    css,
    otherDeductions,
    totalEmployeeDeductions,
    netSalary: roundMillime(grossSalary - totalEmployeeDeductions),
    employerCost: roundMillime(grossSalary + cnssEmployer),
  }
}

/** Heures mensuelles du régime 48 h déduites du SMIG (554,736 / 2,667 ≈ 208 h). */
export function monthlyHoursFromSmig(params: PayrollParams = DEFAULT_PAYROLL_PARAMS_2026): number {
  return params.smigHourly > 0 ? Math.round(params.smigMonthly / params.smigHourly) : 208
}

/** Taux horaire de l'employé (salaire de base / heures du régime), jamais inférieur au SMIG horaire. */
export function hourlyRate(baseSalary: number, params: PayrollParams = DEFAULT_PAYROLL_PARAMS_2026): number {
  const hours = monthlyHoursFromSmig(params)
  const own = hours > 0 ? Number(baseSalary) / hours : 0
  return Math.max(Number.isFinite(own) ? own : 0, params.smigHourly)
}

/**
 * Montant des heures supplémentaires. `multiplier` = coefficient (1,25 / 1,5 / 1,75) ;
 * une valeur > 3 est interprétée comme une majoration en % (25 → 1,25).
 */
export function computeOvertimeAmount(hours: number, multiplier: number, rate: number): number {
  const h = Number(hours)
  if (!Number.isFinite(h) || h <= 0) return 0
  let m = Number(multiplier)
  if (!Number.isFinite(m) || m <= 0) m = 1.25
  if (m > 3) m = 1 + m / 100
  return roundMillime(h * rate * m)
}

/** Contrôle d'un enregistrement de paramètres saisi (taux en %, montants ≥ 0). Retourne un message FR ou null. */
export function validatePayrollParamsInput(input: Record<string, unknown>): string | null {
  const pct = ['tauxCnssSalarial', 'tauxCnssPatronal', 'fraisProTaux', 'cssTaux', 'irppTaux1', 'irppTaux2', 'irppTaux3', 'irppTaux4', 'irppTaux5', 'irppTaux6', 'irppTaux7', 'irppTaux8']
  for (const k of pct) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue
    const n = Number(input[k])
    if (!Number.isFinite(n) || n < 0 || n > 100) return `Taux invalide (${k}) : valeur attendue entre 0 et 100 %`
  }
  const amounts = ['fraisProPlafond', 'deductionChefFamille', 'deductionParEnfant', 'cssSeuilExoneration', 'smigMensuel', 'smigHoraire', 'enfantsMaxDeductible']
  for (const k of amounts) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue
    const n = Number(input[k])
    if (!Number.isFinite(n) || n < 0) return `Montant invalide (${k}) : valeur positive attendue`
  }
  return null
}

/** Champs de PaieParameters modifiables par le tenant (liste blanche). */
export const PAIE_PARAM_FIELDS = [
  'annee',
  'irppTranche1Max', 'irppTranche2Max', 'irppTranche3Max', 'irppTranche4Max', 'irppTranche5Max', 'irppTranche6Max', 'irppTranche7Max',
  'irppTaux1', 'irppTaux2', 'irppTaux3', 'irppTaux4', 'irppTaux5', 'irppTaux6', 'irppTaux7', 'irppTaux8',
  'tauxCnssSalarial', 'tauxCnssPatronal', 'fraisProTaux', 'fraisProPlafond', 'cssTaux', 'cssSeuilExoneration',
  'deductionChefFamille', 'deductionParEnfant', 'enfantsMaxDeductible', 'smigMensuel', 'smigHoraire',
  'heuresSup25', 'heuresSup50', 'heuresSup75',
] as const

const INT_PARAM_FIELDS = new Set(['annee', 'enfantsMaxDeductible'])

/**
 * Paramètres saisis → données à enregistrer : champs hors liste blanche ignorés, valeurs vides ignorées,
 * nombres décimaux à virgule acceptés. Retourne { data } ou { error } (message français).
 * `current` (enregistrement existant) sert au contrôle de cohérence du barème (bornes croissantes).
 */
export function sanitizePaieParamsInput(
  input: Record<string, unknown>,
  current?: Record<string, unknown> | null,
): { data: Record<string, number>; error?: undefined } | { error: string; data?: undefined } {
  const data: Record<string, number> = {}
  for (const k of PAIE_PARAM_FIELDS) {
    const raw = input[k]
    if (raw === undefined || raw === null || raw === '') continue
    const n = Number(typeof raw === 'string' ? raw.replace(',', '.').trim() : raw)
    if (!Number.isFinite(n)) return { error: `Valeur numérique attendue pour ${k}` }
    if (INT_PARAM_FIELDS.has(k) && !Number.isInteger(n)) return { error: `Nombre entier attendu pour ${k}` }
    data[k] = n
  }
  if (data.annee !== undefined && (data.annee < 2000 || data.annee > 2100)) return { error: 'Année invalide' }
  const err = validatePayrollParamsInput(data)
  if (err) return { error: err }
  const maxKeys = ['irppTranche1Max', 'irppTranche2Max', 'irppTranche3Max', 'irppTranche4Max', 'irppTranche5Max', 'irppTranche6Max', 'irppTranche7Max']
  if (maxKeys.some(k => data[k] !== undefined)) {
    const merged = maxKeys.map(k => (data[k] !== undefined ? data[k] : Number(current?.[k] ?? NaN)))
    if (merged.every(Number.isFinite)) {
      const ok = merged.every((m, i) => m > 0 && (i === 0 || m > merged[i - 1]))
      if (!ok) return { error: 'Barème IRPP incohérent : les bornes des tranches doivent être strictement croissantes' }
    }
  }
  return { data }
}
