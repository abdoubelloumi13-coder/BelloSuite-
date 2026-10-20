import { calculerRS, getRSRule, tejMatricule, isValidMatriculeFiscal } from '@/lib/retenue-source'
import { calculateRetenueSource, calculateIRCPHonitaires } from '@/lib/fiscal'

describe('Retenue à la source — taux 2026 (art. 52 Code IRPP/IS)', () => {
  test('acquisitions ≥ 1 000 DT TTC selon le régime du fournisseur', () => {
    expect(getRSRule('PRESTATION_SERVICE', 'SOCIETE', 'IS_20', 1190)).toMatchObject({ taux: 0.01, tejCode: 'RS7_000002' })
    expect(getRSRule('PRESTATION_SERVICE', 'INDIVIDU', 'STANDARD', 1190)).toMatchObject({ taux: 0.015, tejCode: 'RS7_000001' })
    expect(getRSRule('PRESTATION_SERVICE', 'SOCIETE', 'IS_10', 1190)).toMatchObject({ taux: 0.005, tejCode: 'RS7_000003' })
  })

  test('pas de retenue sous 1 000 DT TTC', () => {
    expect(calculerRS({ montantBrut: 999.999, serviceType: 'PRESTATION_SERVICE', beneficiaryType: 'SOCIETE' }).montantRS).toBe(0)
  })

  test('honoraires : 3 % réel / société, 10 % forfait', () => {
    expect(getRSRule('HONORAIRES', 'SOCIETE').taux).toBe(0.03)
    expect(getRSRule('HONORAIRES', 'INDIVIDU', 'STANDARD').taux).toBe(0.03)
    expect(getRSRule('HONORAIRES', 'INDIVIDU', 'FORFAIT')).toMatchObject({ taux: 0.10, tejCode: 'RS2_000001' })
  })

  test('loyers 10 %, hôtels 5 %, dividendes PP 10 % / PM 0 %', () => {
    expect(getRSRule('LOYERS', 'INDIVIDU').taux).toBe(0.10)
    expect(getRSRule('LOYERS', 'SOCIETE', 'HOTEL').taux).toBe(0.05)
    expect(getRSRule('DIVIDENDES', 'INDIVIDU').taux).toBe(0.10)
    expect(getRSRule('DIVIDENDES', 'SOCIETE').taux).toBe(0)
  })

  test('calcul au millime sur le TTC', () => {
    const r = calculerRS({ montantBrut: 2380, serviceType: 'PRESTATION_SERVICE', beneficiaryType: 'SOCIETE', regime: 'IS_20' })
    expect(r.montantRS).toBe(23.8)
    expect(r.montantNet).toBe(2356.2)
  })

  test('note d’honoraires : 3 % du TTC, plus d’IRPP catégoriel', () => {
    expect(calculateRetenueSource(1191, 1000)).toBe(35.73)
    expect(calculateRetenueSource(1191, 1000, true)).toBe(119.1)
    expect(calculateIRCPHonitaires(1000)).toBe(0)
  })

  test('matricule fiscal → identifiant TEJ', () => {
    expect(tejMatricule('1234567A/M/A/000')).toBe('1234567A')
    expect(tejMatricule('1234567AMA000')).toBe('1234567A')
    expect(isValidMatriculeFiscal('1234567A')).toBe(true)
    expect(isValidMatriculeFiscal('12345678ABC')).toBe(false)
  })
})
