/** Règles pures absences / retards (Code du travail tunisien : repos hebdomadaire le dimanche). */

export const ABSENCE_TYPES = ['MALADIE', 'ACCIDENT_TRAVAIL', 'CONGE_PAYE', 'SANS_SOLDE', 'MATERNITE', 'PATERNITE', 'AUTRE'] as const
export const ABSENCE_STATUSES = ['EN_ATTENTE', 'APPROUVE', 'REJETE'] as const
export const SANCTIONS = ['RIEN', 'AVERTISSEMENT', 'RETENUE'] as const

const DAY = 86_400_000
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

/**
 * Jours d'absence entre deux dates incluses :
 *  - joursCal : calendaires ;
 *  - joursOuvrables : hors dimanches (base légale des congés payés, semaine de 6 jours) ;
 *  - joursOuvres : hors samedis et dimanches (régime 5 jours).
 * Renvoie null si les dates sont invalides ou inversées.
 */
export function countAbsenceDays(start: Date, end: Date): { joursCal: number; joursOuvrables: number; joursOuvres: number } | null {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
  const s = utcDay(start)
  const e = utcDay(end)
  if (e < s) return null
  let joursCal = 0, joursOuvrables = 0, joursOuvres = 0
  for (let t = s; t <= e && joursCal < 3660; t += DAY) {
    joursCal++
    const wd = new Date(t).getUTCDay()
    if (wd !== 0) joursOuvrables++
    if (wd !== 0 && wd !== 6) joursOuvres++
  }
  return { joursCal, joursOuvrables, joursOuvres }
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/
export const isHHMM = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v)

/** Minutes de retard (0 si arrivée à l'heure ou en avance). null si une heure est invalide. */
export function lateMinutes(arrivee: string, normale: string): number | null {
  if (!isHHMM(arrivee) || !isHHMM(normale)) return null
  const m = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
  return Math.max(0, m(arrivee) - m(normale))
}

// ─── Report des présences sur la paie ───────────────────────────────

/** Régime de référence : 26 jours ouvrables par mois, 8 h par jour (≈ 208 h, régime 48 h). */
export const PAYROLL_DAYS_PER_MONTH = 26
export const PAYROLL_HOURS_PER_DAY = 8

export interface AttendanceAbsence {
  dateDebut: Date | string
  dateFin: Date | string
  type: string
  justifie: boolean
  statut: string
  montantRetenu?: unknown
}
export interface AttendanceDelay {
  date: Date | string
  minutesRetard: number
  justifie: boolean
  statut: string
  montantRetenu?: unknown
}

/**
 * Une absence approuvée est retenue sur salaire si c'est un congé sans solde, ou si elle n'est pas
 * justifiée (hors congé payé). Les absences justifiées pour maladie, accident du travail, maternité ou
 * paternité ne sont pas retenues automatiquement : leur indemnisation dépend de la CNAM et de la
 * convention collective (saisie manuelle du montant retenu sur l'absence si nécessaire).
 */
export function isUnpaidAbsence(a: Pick<AttendanceAbsence, 'type' | 'justifie'>): boolean {
  if (a.type === 'SANS_SOLDE') return true
  if (a.type === 'CONGE_PAYE') return false
  return !a.justifie
}

/** Jours ouvrables (hors dimanches) d'une absence compris dans le mois donné. */
export function absenceWorkingDaysInMonth(a: Pick<AttendanceAbsence, 'dateDebut' | 'dateFin'>, month: number, year: number): number {
  const monthStart = Date.UTC(year, month - 1, 1)
  const monthEnd = Date.UTC(year, month, 0)
  const s = Math.max(utcDay(new Date(a.dateDebut)), monthStart)
  const e = Math.min(utcDay(new Date(a.dateFin)), monthEnd)
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0
  return countAbsenceDays(new Date(s), new Date(e))?.joursOuvrables ?? 0
}

const r3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * Retenues de paie d'un mois à partir des absences et retards APPROUVÉS :
 *  - absences non payées : jours ouvrables du mois × salaire / 26 (ou montant retenu saisi, au prorata du mois) ;
 *  - retards non justifiés : minutes × salaire / (26 × 8 × 60) (ou montant retenu saisi) ;
 *  - total plafonné au salaire de base ; jours travaillés = 26 − jours non payés.
 */
export function attendancePayrollDeductions(input: {
  baseSalary: number
  month: number
  year: number
  absences: AttendanceAbsence[]
  delays: AttendanceDelay[]
}) {
  const salary = Math.max(0, Number(input.baseSalary) || 0)
  const daily = salary / PAYROLL_DAYS_PER_MONTH
  const perMinute = daily / (PAYROLL_HOURS_PER_DAY * 60)
  let unpaidDays = 0
  let absenceAmount = 0
  for (const a of input.absences) {
    if (a.statut !== 'APPROUVE' || !isUnpaidAbsence(a)) continue
    const days = absenceWorkingDaysInMonth(a, input.month, input.year)
    if (days === 0) continue
    unpaidDays += days
    const manual = Number(a.montantRetenu) || 0
    if (manual > 0) {
      const total = countAbsenceDays(new Date(a.dateDebut), new Date(a.dateFin))?.joursOuvrables || days
      absenceAmount += manual * (days / total)
    } else {
      absenceAmount += days * daily
    }
  }
  unpaidDays = Math.min(unpaidDays, PAYROLL_DAYS_PER_MONTH)
  absenceAmount = Math.min(absenceAmount, salary)

  let lateMinutesTotal = 0
  let delayAmount = 0
  for (const d of input.delays) {
    if (d.statut !== 'APPROUVE' || d.justifie) continue
    const dt = new Date(d.date)
    if (dt.getUTCFullYear() !== input.year || dt.getUTCMonth() + 1 !== input.month) continue
    lateMinutesTotal += Math.max(0, Number(d.minutesRetard) || 0)
    const manual = Number(d.montantRetenu) || 0
    delayAmount += manual > 0 ? manual : Math.max(0, Number(d.minutesRetard) || 0) * perMinute
  }
  delayAmount = Math.min(delayAmount, salary - absenceAmount)

  return {
    deductionAbsences: r3(absenceAmount),
    deductionRetards: r3(Math.max(0, delayAmount)),
    unpaidDays,
    lateMinutes: lateMinutesTotal,
    joursTravailles: PAYROLL_DAYS_PER_MONTH - unpaidDays,
  }
}
