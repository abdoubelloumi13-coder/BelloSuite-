import {
  computePayslip,
  computeAnnualIrpp,
  computeOvertimeAmount,
  hourlyRate,
  monthlyHoursFromSmig,
  payrollParamsFromRecord,
  roundMillime,
  validatePayrollParamsInput,
  DEFAULT_PAYROLL_PARAMS_2026,
  IRPP_BRACKETS_LF2025,
} from '@/lib/payroll'

describe('payroll — barème IRPP LF 2025', () => {
  it('tranche à 0 % jusqu’à 5 000 DT', () => {
    expect(computeAnnualIrpp(5000)).toBe(0)
    expect(computeAnnualIrpp(0)).toBe(0)
    expect(computeAnnualIrpp(-10)).toBe(0)
  })
  it('cumul progressif des tranches', () => {
    // 5000×15 % + 10000×25 % + 10000×30 % + 10000×33 % + 10000×36 % + 20000×38 % + 10000×40 %
    expect(roundMillime(computeAnnualIrpp(80000))).toBe(750 + 2500 + 3000 + 3300 + 3600 + 7600 + 4000)
    expect(roundMillime(computeAnnualIrpp(14131.84))).toBe(1782.96)
  })
  it('le barème par défaut a 8 tranches et finit à 40 %', () => {
    expect(IRPP_BRACKETS_LF2025).toHaveLength(8)
    expect(IRPP_BRACKETS_LF2025[7]).toEqual({ upTo: null, rate: 40 })
  })
})

describe('payroll — bulletins 2026', () => {
  it('1 500 DT, marié chef de famille, 2 enfants', () => {
    const r = computePayslip({ baseSalary: 1500, isHeadOfFamily: true, childrenCount: 2 })
    expect(r.grossSalary).toBe(1500)
    expect(r.cnssEmployee).toBe(145.2) // 9,68 %
    expect(r.cnssEmployer).toBe(256.05) // 17,07 %
    expect(r.taxableMonthly).toBe(1354.8)
    expect(r.annualProfessionalExpenses).toBe(1625.76)
    expect(r.annualHeadOfFamilyDeduction).toBe(300)
    expect(r.annualChildrenDeduction).toBe(200)
    expect(r.annualTaxBase).toBe(14131.84)
    expect(r.irpp).toBe(148.58)
    expect(r.css).toBe(5.888)
    expect(r.netSalary).toBe(1200.332)
    expect(r.employerCost).toBe(1756.05)
  })

  it('2 000 DT, célibataire sans enfant', () => {
    const r = computePayslip({ baseSalary: 2000, isHeadOfFamily: false, childrenCount: 0 })
    expect(r.cnssEmployee).toBe(193.6)
    expect(r.annualProfessionalExpenses).toBe(2000) // plafond atteint
    expect(r.annualTaxBase).toBe(19676.8)
    expect(r.irpp).toBe(264.1)
    expect(r.css).toBe(8.199)
    expect(r.netSalary).toBe(1534.101)
  })

  it('SMIG 2026 (48 h) : 554,736 DT', () => {
    const r = computePayslip({ baseSalary: DEFAULT_PAYROLL_PARAMS_2026.smigMonthly, isHeadOfFamily: false, childrenCount: 0 })
    expect(r.cnssEmployee).toBe(53.698)
    expect(r.annualTaxBase).toBe(5411.21)
    expect(r.irpp).toBe(5.14)
    expect(r.css).toBe(2.255)
    expect(r.netSalary).toBe(493.643)
  })

  it('CSS exonérée quand le revenu imposable annuel ≤ 5 000 DT', () => {
    const r = computePayslip({ baseSalary: 554.736, isHeadOfFamily: true, childrenCount: 2 })
    expect(r.annualTaxBase).toBeLessThanOrEqual(5000)
    expect(r.irpp).toBe(0)
    expect(r.css).toBe(0)
  })

  it('déduction enfants plafonnée à 4 enfants', () => {
    const r4 = computePayslip({ baseSalary: 1500, isHeadOfFamily: true, childrenCount: 4 })
    const r6 = computePayslip({ baseSalary: 1500, isHeadOfFamily: true, childrenCount: 6 })
    expect(r4.annualChildrenDeduction).toBe(400)
    expect(r6.annualChildrenDeduction).toBe(400)
    expect(r6.netSalary).toBe(r4.netSalary)
  })

  it('net = brut − (CNSS + IRPP + CSS + autres retenues)', () => {
    const r = computePayslip({ baseSalary: 1800, overtimeAmount: 50, transportBonus: 30, otherDeductions: 100, isHeadOfFamily: false, childrenCount: 1 })
    expect(r.grossSalary).toBe(1880)
    expect(r.netSalary).toBe(roundMillime(r.grossSalary - r.cnssEmployee - r.irpp - r.css - 100))
  })

  it('les retenues absences/retards réduisent le brut', () => {
    const r = computePayslip({ baseSalary: 1000, absenceDeduction: 100, delayDeduction: 20, isHeadOfFamily: false, childrenCount: 0 })
    expect(r.grossSalary).toBe(880)
  })

  it('refuse un salaire invalide', () => {
    expect(() => computePayslip({ baseSalary: NaN, isHeadOfFamily: false, childrenCount: 0 })).toThrow('Salaire de base invalide')
  })
})

describe('payroll — paramètres', () => {
  it('sans enregistrement : valeurs 2026', () => {
    const p = payrollParamsFromRecord(null)
    expect(p.cnssEmployeeRate).toBe(9.68)
    expect(p.cnssEmployerRate).toBe(17.07)
    expect(p.headOfFamilyDeduction).toBe(300)
    expect(p.childDeduction).toBe(100)
    expect(p.maxChildren).toBe(4)
    expect(p.smigMonthly).toBe(554.736)
  })
  it('taux CNSS paramétrables (Decimal/chaînes acceptés)', () => {
    const p = payrollParamsFromRecord({ tauxCnssSalarial: '9.18', tauxCnssPatronal: 16.57 })
    expect(p.cnssEmployeeRate).toBe(9.18)
    expect(p.cnssEmployerRate).toBe(16.57)
    const r = computePayslip({ baseSalary: 1000, isHeadOfFamily: false, childrenCount: 0 }, p)
    expect(r.cnssEmployee).toBe(91.8)
  })
  it('lit le barème à 8 tranches quand toutes les colonnes existent', () => {
    const rec = {
      irppTranche1Max: 5000, irppTranche2Max: 10000, irppTranche3Max: 20000, irppTranche4Max: 30000,
      irppTranche5Max: 40000, irppTranche6Max: 50000, irppTranche7Max: 70000,
      irppTaux1: 0, irppTaux2: 15, irppTaux3: 25, irppTaux4: 30, irppTaux5: 33, irppTaux6: 36, irppTaux7: 38, irppTaux8: 40,
    }
    expect(payrollParamsFromRecord(rec).irppBrackets).toEqual(IRPP_BRACKETS_LF2025)
  })
  it('ignore un ancien barème incomplet (5 tranches) et garde LF 2025', () => {
    const p = payrollParamsFromRecord({ irppTranche1Max: 5000, irppTaux2: 26 })
    expect(p.irppBrackets).toEqual(IRPP_BRACKETS_LF2025)
  })
  it('validation des saisies', () => {
    expect(validatePayrollParamsInput({ tauxCnssSalarial: 9.68 })).toBeNull()
    expect(validatePayrollParamsInput({ tauxCnssSalarial: 140 })).toMatch(/Taux invalide/)
    expect(validatePayrollParamsInput({ smigMensuel: -1 })).toMatch(/Montant invalide/)
  })
})

describe('payroll — heures supplémentaires', () => {
  it('régime 48 h : 208 heures/mois', () => {
    expect(monthlyHoursFromSmig()).toBe(208)
  })
  it('taux horaire de l’employé, jamais sous le SMIG horaire', () => {
    expect(roundMillime(hourlyRate(2080))).toBe(10)
    expect(hourlyRate(100)).toBe(2.667)
  })
  it('coefficient 1,25 ou majoration en %', () => {
    expect(computeOvertimeAmount(10, 1.25, 10)).toBe(125)
    expect(computeOvertimeAmount(10, 50, 10)).toBe(150)
    expect(computeOvertimeAmount(0, 1.25, 10)).toBe(0)
  })
})
