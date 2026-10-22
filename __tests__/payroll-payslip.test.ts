import {
  assertBalanced,
  buildPayrollJournalLines,
  computeEmployeePayslip,
  payslipAmounts,
  payslipReference,
  payrollErrorMessage,
  PayrollBalanceError,
} from '@/lib/payroll-payslip'
import { DEFAULT_PAYROLL_PARAMS_2026, payrollParamsFromRecord } from '@/lib/payroll'

const P = DEFAULT_PAYROLL_PARAMS_2026

describe('payroll-payslip — bulletin à partir de la fiche employé', () => {
  it('1 500 DT, marié chef de famille, 2 enfants', () => {
    const emp = { employeeNumber: 'AUD-001', salary: '1500', situationFamiliale: 'CHEF_FAMILLE', enfantsCharge: 2 }
    const c = computeEmployeePayslip(emp, P)
    expect(c.grossSalary).toBe(1500)
    expect(c.cnssEmployee).toBe(145.2) // 9,68 %
    expect(c.cnssEmployer).toBe(256.05) // 17,07 %
    // imposable annuel = 1354,8 × 12 = 16 257,6 ; frais pro 10 % = 1 625,76 ; − 300 − 200 → 14 131,84
    expect(c.annualTaxBase).toBe(14131.84)
    // IRPP = 5000×15 % + 4131,84×25 % = 750 + 1032,96 = 1782,96 → 148,58 / mois
    expect(c.irpp).toBe(148.58)
    // CSS = 0,5 % × 14 131,84 = 70,6592 → 5,888 / mois
    expect(c.css).toBe(5.888)
    expect(c.netSalary).toBe(1200.332)

    const a = payslipAmounts(emp, c)
    expect(a.brutGlobal).toBe(1500)
    expect(a.totalCotisations).toBe(145.2)
    expect(a.cnssPatronal).toBe(256.05)
    expect(a.netAPayer).toBe(1200.332)
    expect(a.deductionChefFam).toBe(25)
    expect(a.deductionEnfants).toBeCloseTo(16.667, 3)
    expect(a.cnrpsSalaire).toBe(0)
  })

  it('célibataire sans enfant : pas de déduction famille', () => {
    const c = computeEmployeePayslip({ employeeNumber: 'X', salary: 1500, situationFamiliale: 'NON_CHEF_FAMILLE', enfantsCharge: 3 }, P)
    expect(c.annualHeadOfFamilyDeduction).toBe(0)
    expect(c.annualChildrenDeduction).toBe(300) // les enfants à charge restent déductibles
  })

  it('recalcul : heures sup et primes existantes conservées', () => {
    const emp = { employeeNumber: 'X', salary: 1000 }
    const c = computeEmployeePayslip(emp, P, { heuresSupMontant: 50, primeTransport: 30, heuresSupQte: 10 })
    expect(c.grossSalary).toBe(1080)
    const a = payslipAmounts(emp, c, { heuresSupMontant: 50, primeTransport: 30, heuresSupQte: 10 })
    expect(a.heuresSupQte).toBe(10)
    expect(a.salaireBase).toBe(1000)
  })

  it('paramètres tenant : taux CNSS personnalisés pris en compte', () => {
    const params = payrollParamsFromRecord({ tauxCnssSalarial: '10', tauxCnssPatronal: '18' })
    const c = computeEmployeePayslip({ employeeNumber: 'X', salary: 1000 }, params)
    expect(c.cnssEmployee).toBe(100)
    expect(c.cnssEmployer).toBe(180)
  })

  it('référence de bulletin', () => {
    expect(payslipReference(10, 2026, 'AUD-001')).toBe('OCT-2026-AUD-001')
  })
})

describe('payroll-payslip — écriture de paie équilibrée', () => {
  it('640 + 647 = 453 + 432 + 425', () => {
    const emp = { employeeNumber: 'A', salary: 1500, situationFamiliale: 'CHEF_FAMILLE', enfantsCharge: 2 }
    const a = payslipAmounts(emp, computeEmployeePayslip(emp, P))
    const b = payslipAmounts({ employeeNumber: 'B', salary: 2300 }, computeEmployeePayslip({ employeeNumber: 'B', salary: 2300 }, P))
    const lines = buildPayrollJournalLines([a, b], '10/2026')
    const get = (acc: string) => lines.find(l => l.account === acc)!
    expect(get('640').debit).toBe(3800)
    expect(get('647').debit).toBeCloseTo(256.05 + 392.61, 3)
    expect(get('453').credit).toBeCloseTo(a.cnssSalaire + b.cnssSalaire + a.cnssPatronal + b.cnssPatronal, 3)
    expect(get('432').credit).toBeCloseTo(a.irpp + a.css + b.irpp + b.css, 3)
    expect(get('425').credit).toBeCloseTo(a.netAPayer + b.netAPayer, 3)
    const d = lines.reduce((s, l) => s + l.debit, 0)
    const c = lines.reduce((s, l) => s + l.credit, 0)
    expect(Math.abs(d - c)).toBeLessThan(0.0005)
  })

  it('autres retenues (avance) restent créditées en 425 : écriture toujours équilibrée', () => {
    const emp = { employeeNumber: 'A', salary: 1500 }
    const a = payslipAmounts(emp, computeEmployeePayslip(emp, P, { autresDeductions: 200 }), { autresDeductions: 200 })
    const lines = buildPayrollJournalLines([a], '10/2026')
    expect(lines.find(l => l.account === '425')!.credit).toBeCloseTo(a.netAPayer + 200, 3)
  })

  it('bulletin ancien sans CNSS patronale enregistrée : repli sur le taux', () => {
    const lines = buildPayrollJournalLines([{ brutGlobal: 1000, cnssSalaire: 96.8, irpp: 50, netAPayer: 853.2 }], '01/2026')
    expect(lines.find(l => l.account === '647')!.debit).toBe(170.7)
  })

  it('contrôle d’équilibre', () => {
    expect(() => assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 99.99 }])).toThrow(PayrollBalanceError)
    expect(() => assertBalanced([{ debit: 0, credit: 0 }])).toThrow(/vide/)
    expect(() => assertBalanced([{ debit: '100.0004', credit: 0 }, { debit: 0, credit: 100 }])).not.toThrow()
  })
})

describe('payroll-payslip — erreurs en français', () => {
  it('colonne manquante', () => {
    expect(payrollErrorMessage({ code: 'P2022', meta: { column: 'PaySlip.css' } })).toMatch(/colonne PaySlip.css manquante.*20261022000300/)
  })
  it('table absente', () => {
    expect(payrollErrorMessage({ code: 'P2021', meta: { table: 'public.PaieParameters' } })).toMatch(/table de paie absente/)
  })
  it('colonne héritée NOT NULL (PostgreSQL 23502)', () => {
    expect(payrollErrorMessage({ message: 'null value in column "periodStart" violates not-null constraint (23502)' })).toMatch(/ancienne colonne obligatoire/)
  })
  it('doublon', () => {
    expect(payrollErrorMessage({ code: 'P2002' })).toMatch(/même référence/)
  })
  it('inconnue : jamais « Internal error »', () => {
    const m = payrollErrorMessage(new Error('boom'))
    expect(m).toMatch(/erreur inattendue/)
    expect(m).not.toMatch(/Internal/)
  })
})

describe('payroll-payslip — heures supplémentaires au SMIG 2026', () => {
  it('salaire au SMIG : 10 h à +25 % au taux 2,667 DT/h, net recalculé', () => {
    const { hourlyRate, computeOvertimeAmount } = jest.requireActual('@/lib/payroll')
    const emp = { employeeNumber: 'S', salary: 554.736 }
    const rate = hourlyRate(554.736, P)
    expect(rate).toBeCloseTo(2.667, 3)
    const amount = computeOvertimeAmount(10, 1.25, rate)
    expect(amount).toBeCloseTo(33.338, 3)
    const before = computeEmployeePayslip(emp, P)
    const after = computeEmployeePayslip(emp, P, { heuresSupMontant: amount, heuresSupQte: 10 })
    expect(after.grossSalary).toBeCloseTo(554.736 + amount, 3)
    expect(after.cnssEmployee).toBeCloseTo((554.736 + amount) * 0.0968, 2)
    expect(after.netSalary).toBeGreaterThan(before.netSalary)
  })
  it('salaire inférieur au SMIG horaire : taux plancher 2,667 DT/h', () => {
    const { hourlyRate } = jest.requireActual('@/lib/payroll')
    expect(hourlyRate(300, P)).toBe(2.667)
  })
})
