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
