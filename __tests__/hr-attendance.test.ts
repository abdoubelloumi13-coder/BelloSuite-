import { countAbsenceDays, lateMinutes } from '@/lib/hr-attendance'

describe('absences et retards', () => {
  it('compte calendaires, ouvrables (hors dimanche) et ouvrés (hors week-end)', () => {
    // lundi 19 → dimanche 25 octobre 2026
    expect(countAbsenceDays(new Date('2026-10-19'), new Date('2026-10-25'))).toEqual({ joursCal: 7, joursOuvrables: 6, joursOuvres: 5 })
    expect(countAbsenceDays(new Date('2026-10-23'), new Date('2026-10-23'))).toEqual({ joursCal: 1, joursOuvrables: 1, joursOuvres: 1 })
  })
  it('refuse des dates inversées ou invalides', () => {
    expect(countAbsenceDays(new Date('2026-10-25'), new Date('2026-10-19'))).toBeNull()
    expect(countAbsenceDays(new Date('x'), new Date('2026-10-19'))).toBeNull()
  })
  it('calcule les minutes de retard', () => {
    expect(lateMinutes('08:17', '08:00')).toBe(17)
    expect(lateMinutes('07:50', '08:00')).toBe(0)
    expect(lateMinutes('8h', '08:00')).toBeNull()
  })
})

import { attendancePayrollDeductions, isUnpaidAbsence } from '@/lib/hr-attendance'

describe('report des présences sur la paie', () => {
  const base = { baseSalary: 1300, month: 10, year: 2026 }
  it('retient les absences non payées approuvées au prorata de 26 jours', () => {
    // sans solde lun 19 → mer 21 oct. 2026 : 3 jours ouvrables → 3 × 50 = 150
    const r = attendancePayrollDeductions({ ...base, delays: [], absences: [
      { dateDebut: '2026-10-19', dateFin: '2026-10-21', type: 'SANS_SOLDE', justifie: true, statut: 'APPROUVE' },
      { dateDebut: '2026-10-05', dateFin: '2026-10-09', type: 'CONGE_PAYE', justifie: true, statut: 'APPROUVE' },
      { dateDebut: '2026-10-12', dateFin: '2026-10-12', type: 'AUTRE', justifie: false, statut: 'EN_ATTENTE' },
    ] })
    expect(r).toMatchObject({ deductionAbsences: 150, unpaidDays: 3, joursTravailles: 23 })
  })
  it('ne compte que les jours du mois pour une absence à cheval', () => {
    // 29 oct. → 3 nov. 2026 : jeu, ven, sam en octobre = 3 jours ouvrables
    const r = attendancePayrollDeductions({ ...base, delays: [], absences: [
      { dateDebut: '2026-10-29', dateFin: '2026-11-03', type: 'AUTRE', justifie: false, statut: 'APPROUVE' },
    ] })
    expect(r.unpaidDays).toBe(3)
  })
  it('ne retient pas une maladie justifiée', () => {
    expect(isUnpaidAbsence({ type: 'MALADIE', justifie: true })).toBe(false)
    expect(isUnpaidAbsence({ type: 'MALADIE', justifie: false })).toBe(true)
  })
  it('retient les retards approuvés non justifiés à la minute', () => {
    // 1300 / 26 / 480 = 0,104166… par minute ; 30 min → 3,125
    const r = attendancePayrollDeductions({ ...base, absences: [], delays: [
      { date: '2026-10-20', minutesRetard: 30, justifie: false, statut: 'APPROUVE' },
      { date: '2026-10-21', minutesRetard: 45, justifie: true, statut: 'APPROUVE' },
      { date: '2026-09-21', minutesRetard: 45, justifie: false, statut: 'APPROUVE' },
    ] })
    expect(r).toMatchObject({ deductionRetards: 3.125, lateMinutes: 30 })
  })
})
