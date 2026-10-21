import { sanitizePaieParamsInput, payrollParamsFromRecord } from '@/lib/payroll'

describe('paramètres de paie — saisie', () => {
  it('liste blanche + conversion (virgule décimale) ; tenantId/id ignorés', () => {
    const r = sanitizePaieParamsInput({ tauxCnssSalarial: '9,68', tauxCnssPatronal: 17.07, tenantId: 'x', id: 'y', smigHoraire: '' })
    expect(r).toEqual({ data: { tauxCnssSalarial: 9.68, tauxCnssPatronal: 17.07 } })
  })
  it('taux hors bornes refusé en français', () => {
    expect(sanitizePaieParamsInput({ tauxCnssSalarial: 140 }).error).toMatch(/Taux invalide/)
    expect(sanitizePaieParamsInput({ smigMensuel: 'abc' }).error).toMatch(/Valeur numérique/)
    expect(sanitizePaieParamsInput({ enfantsMaxDeductible: 2.5 }).error).toMatch(/entier/)
  })
  it('barème : bornes croissantes contrôlées avec l’existant', () => {
    const current = { irppTranche1Max: 5000, irppTranche2Max: 10000, irppTranche3Max: 20000, irppTranche4Max: 30000, irppTranche5Max: 40000, irppTranche6Max: 50000, irppTranche7Max: 70000 }
    expect(sanitizePaieParamsInput({ irppTranche3Max: 9000 }, current).error).toMatch(/croissantes/)
    expect(sanitizePaieParamsInput({ irppTranche3Max: 25000 }, current).data).toEqual({ irppTranche3Max: 25000 })
  })
  it('les valeurs enregistrées alimentent le moteur', () => {
    const p = payrollParamsFromRecord({ tauxCnssSalarial: 10, smigMensuel: 600, smigHoraire: 3 })
    expect(p.cnssEmployeeRate).toBe(10)
    expect(p.cnssEmployerRate).toBe(17.07)
    expect(p.smigHourly).toBe(3)
  })
})
