jest.mock('@/lib/db', () => ({ prisma: {} }))
import { createWithholdingTaxSchema } from '@/services/withholding-tax'
import { zodFieldErrors, dropEmptyStrings } from '@/lib/zod-errors'
import { ventilateFromSource, recordToCertificate } from '@/lib/tej-generator'

const base = {
  tenantId: 't1', beneficiaryName: 'Audit RS Test', serviceType: 'HONORAIRES', beneficiaryType: 'INDIVIDU',
  grossAmount: '1500', periodMonth: '10', periodYear: '2026',
}

describe('formulaire RS : validation champ par champ', () => {
  it('matricule légal de 13 caractères accepté (avec ou sans séparateurs)', () => {
    expect(createWithholdingTaxSchema.safeParse({ ...base, beneficiaryTin: '0312021PAM000' }).success).toBe(true)
    expect(createWithholdingTaxSchema.safeParse({ ...base, beneficiaryTin: '1234567/A/A/M/000' }).success).toBe(true)
    expect(createWithholdingTaxSchema.safeParse({ ...base, beneficiaryTin: '12345678' }).success).toBe(true) // CIN
  })
  it('matricule invalide : message sur le champ beneficiaryTin', () => {
    const r = createWithholdingTaxSchema.safeParse({ ...base, beneficiaryTin: '12345678AB' })
    expect(r.success).toBe(false)
    const fe = zodFieldErrors((r as any).error)
    expect(Object.keys(fe.fieldErrors)).toEqual(['beneficiaryTin'])
    expect(fe.error).toMatch(/^Matricule fiscal : Matricule fiscal invalide/)
  })
  it('mode de paiement « — » (chaîne vide) ignoré au lieu de « Données invalides »', () => {
    const body = { ...base, paymentMethod: '', paymentDate: '', invoiceId: '', beneficiaryEmail: '' }
    expect(createWithholdingTaxSchema.safeParse(body).success).toBe(false)
    expect(createWithholdingTaxSchema.safeParse(dropEmptyStrings(body, ['beneficiaryName'])).success).toBe(true)
  })
  it('nom vide et montant négatif : deux erreurs en français', () => {
    const r = createWithholdingTaxSchema.safeParse({ ...base, beneficiaryName: '', grossAmount: -5 })
    const fe = zodFieldErrors((r as any).error)
    expect(fe.fieldErrors.beneficiaryName).toMatch(/requis/)
    expect(fe.fieldErrors.grossAmount).toMatch(/positif/)
    expect(fe.error).toMatch(/et 1 autre champ/)
  })
  it('messages zod par défaut traduits', () => {
    const r = createWithholdingTaxSchema.safeParse({ ...base, beneficiaryType: 'XX' })
    expect(zodFieldErrors((r as any).error).fieldErrors.beneficiaryType).toBe('Valeur non autorisée')
  })
})

describe('TEJ : ventilation sur les vrais montants', () => {
  it('paiement total : HT et TVA réels, timbre hors HT/TVA', () => {
    // facture 1000 HT + 10 FODEC + 191,900 TVA + 1 timbre = 1202,900
    expect(ventilateFromSource(1202.9, { ht: 1010, tva: 191.9, ttc: 1202.9, rates: [19] })).toEqual({ montantHT: 1010, montantTVA: 191.9, tauxTVA: 19 })
  })
  it('paiement partiel : prorata', () => {
    expect(ventilateFromSource(601.45, { ht: 1010, tva: 191.9, ttc: 1202.9 })).toEqual({ montantHT: 505, montantTVA: 95.95, tauxTVA: 19 })
  })
  it('certificat depuis une facture fournisseur liée', () => {
    const { cert, missing } = recordToCertificate({
      id: 'r1', tejId: 'T1', beneficiaryTin: '1234567AAM000', beneficiaryName: 'Fournisseur', beneficiaryAddress: 'Tunis',
      beneficiaryType: 'SOCIETE', beneficiaryRegime: 'IS_20', beneficiaryEmail: 'f@x.tn', beneficiaryPhone: '71000000',
      serviceType: 'PRESTATION_SERVICE', grossAmount: 1191, taxAmount: 11.91, rate: 0.01, paymentDate: new Date('2026-10-05'),
      periodYear: 2026, source: { date: new Date('2025-12-20'), ht: 1000, tva: 190, ttc: 1191 },
    })
    expect(missing).toEqual([])
    expect(cert!.operation).toMatchObject({ montantHT: 1000, montantTVA: 190, montantTTC: 1191, anneeFacturation: 2025, tauxTVA: 19 })
  })
})
