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
