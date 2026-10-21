/**
 * @jest-environment node
 */
/* Audit E1/E2 : listes blanches des PUT payslips/[id] et gpao/boms/[id]. */
import { payslipUpdateSchema, payslipChangeBlocked, bomUpdateSchema } from '@/lib/security/update-schemas'

describe('payslipUpdateSchema', () => {
  it('accepte statut et note', () => {
    expect(payslipUpdateSchema.parse({ statut: 'PAID', notes: 'ok' })).toEqual({ statut: 'PAID', notes: 'ok' })
  })
  it.each([
    [{ tenantId: 'X' }], [{ employeeId: 'E' }], [{ employee: { connect: { id: 'E' } } }],
    [{ tenant: { connect: { id: 'T' } } }], [{ netAPayer: 99999 }], [{ accountingEntryId: null }],
  ])('rejette %j', body => {
    expect(payslipUpdateSchema.safeParse(body).success).toBe(false)
  })
  it('fiche comptabilisée : annulation et suppression refusées, paiement permis', () => {
    const posted = { accountingEntryId: 'JE1', statut: 'PENDING' }
    expect(payslipChangeBlocked(posted, { statut: 'CANCELLED' })).toMatch(/comptabilisée/)
    expect(payslipChangeBlocked(posted, 'delete')).toMatch(/comptabilisée/)
    expect(payslipChangeBlocked(posted, { statut: 'PAID' })).toBeNull()
    expect(payslipChangeBlocked({ accountingEntryId: null, statut: 'PENDING' }, 'delete')).toBeNull()
  })
})

describe('bomUpdateSchema', () => {
  it('accepte les champs éditables et convertit les quantités', () => {
    const r = bomUpdateSchema.parse({ version: '2', isActive: true, items: [{ productId: 'p', quantity: '1.5' }] })
    expect(r.items?.[0].quantity).toBe(1.5)
  })
  it('rejette les relations imbriquées et clés inconnues', () => {
    expect(bomUpdateSchema.safeParse({ product: { connect: { id: 'x' } } }).success).toBe(false)
    expect(bomUpdateSchema.safeParse({ tenant: { connect: { id: 'x' } } }).success).toBe(false)
    expect(bomUpdateSchema.safeParse({ items: [{ productId: 'p', quantity: 1, billOfMaterialsId: 'b' }] }).success).toBe(false)
    expect(bomUpdateSchema.safeParse({ items: [{ productId: 'p', quantity: -1 }] }).success).toBe(false)
  })
})
