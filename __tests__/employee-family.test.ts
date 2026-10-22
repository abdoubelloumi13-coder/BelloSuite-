import { normalizeFamily, parseChefFamille, parseEnfantsCharge, parseEtatCivil } from '@/lib/employee-family'
import { updateEmployeeSchema, toEmployeeUpdateData } from '@/services/hr'

describe('employee-family — normalisation', () => {
  it('état civil : libellés français, accents, féminin, codes', () => {
    expect(parseEtatCivil('Marié')).toBe('MARIE')
    expect(parseEtatCivil('mariée')).toBe('MARIE')
    expect(parseEtatCivil('MARIE')).toBe('MARIE')
    expect(parseEtatCivil('Célibataire')).toBe('CELIBATAIRE')
    expect(parseEtatCivil('divorcée')).toBe('DIVORCE')
    expect(parseEtatCivil('Veuve')).toBe('VEUF')
    expect(parseEtatCivil('')).toBeNull()
    expect(parseEtatCivil('pacsé')).toBeNull()
  })
  it('chef de famille : oui/non, 1/0, codes', () => {
    expect(parseChefFamille('oui')).toBe('CHEF_FAMILLE')
    expect(parseChefFamille('Chef de famille')).toBe('CHEF_FAMILLE')
    expect(parseChefFamille(true)).toBe('CHEF_FAMILLE')
    expect(parseChefFamille('NON_CHEF_FAMILLE')).toBe('NON_CHEF_FAMILLE')
    expect(parseChefFamille('0')).toBe('NON_CHEF_FAMILLE')
    expect(parseChefFamille('')).toBeNull()
  })
  it('enfants à charge', () => {
    expect(parseEnfantsCharge('')).toBe(0)
    expect(parseEnfantsCharge('2')).toBe(2)
    expect(parseEnfantsCharge(3)).toBe(3)
    expect(parseEnfantsCharge('-1')).toBeNull()
    expect(parseEnfantsCharge('1.5')).toBeNull()
  })
  it('valeurs absentes → célibataire, non chef de famille (plus de CHEF_FAMILLE par défaut à l’import)', () => {
    expect(normalizeFamily({})).toEqual({ value: { etatCivil: 'CELIBATAIRE', situationFamiliale: 'NON_CHEF_FAMILLE', enfantsCharge: 0 }, errors: [] })
  })
  it('alias chefFamille + erreurs en français', () => {
    expect(normalizeFamily({ etatCivil: 'Marié', chefFamille: 'oui', enfantsCharge: '2' }).value)
      .toEqual({ etatCivil: 'MARIE', situationFamiliale: 'CHEF_FAMILLE', enfantsCharge: 2 })
    const r = normalizeFamily({ etatCivil: 'xx', situationFamiliale: 'peut-être', enfantsCharge: 'deux' })
    expect(r.errors).toHaveLength(3)
    expect(r.errors[0]).toMatch(/État civil/)
  })
})

describe('updateEmployeeSchema — modification de fiche', () => {
  it('accepte la situation familiale et ignore les champs hors liste blanche', () => {
    const r = updateEmployeeSchema.safeParse({ etatCivil: 'MARIE', situationFamiliale: 'CHEF_FAMILLE', enfantsCharge: '2', isActive: false, tenantId: 'autre', email: '' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data).toEqual({ etatCivil: 'MARIE', situationFamiliale: 'CHEF_FAMILLE', enfantsCharge: 2, email: null })
    expect((r.data as Record<string, unknown>).tenantId).toBeUndefined()
  })
  it('refuse un nombre d’enfants négatif', () => {
    const r = updateEmployeeSchema.safeParse({ enfantsCharge: -1 })
    expect(r.success).toBe(false)
  })
  it('convertit les dates et rejette une date invalide', () => {
    expect(toEmployeeUpdateData({ hireDate: '2026-10-21' }).hireDate).toBeInstanceOf(Date)
    expect(() => toEmployeeUpdateData({ hireDate: 'n/a' })).toThrow(/embauche invalide/)
  })
})
