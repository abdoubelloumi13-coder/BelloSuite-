import { moduleCharge, tenantInvoice, activityScore } from '@/lib/super-admin/billing'

const compta = { id: 'm1', name: 'accounting', displayName: 'Comptabilité', monthlyPrice: 17.5, pricePerUser: 3, includedUsers: 2 }
const crm = { id: 'm2', name: 'crm', displayName: 'CRM', monthlyPrice: 14.5, pricePerUser: 2, includedUsers: 5 }

describe('facturation super admin', () => {
  it('facture les utilisateurs au-delà des inclus', () => {
    const c = moduleCharge(compta, { moduleId: 'm1', isEnabled: true }, 4)
    expect(c).toMatchObject({ users: 4, extraUsers: 2, base: 17.5, usersAmount: 6, total: 23.5 })
  })
  it('utilise les sièges attribués, le prix négocié et la remise', () => {
    const c = moduleCharge(compta, { moduleId: 'm1', isEnabled: true, seats: 3, priceOverride: 10, discountPercent: 10 }, 9)
    expect(c).toMatchObject({ users: 3, extraUsers: 1, base: 10, usersAmount: 3, discount: 1.3, total: 11.7, negotiated: true })
  })
  it('totalise les modules activés avec TVA 19 %', () => {
    const inv = tenantInvoice([compta, crm], [
      { moduleId: 'm1', isEnabled: true }, { moduleId: 'm2', isEnabled: false },
    ], 2)
    expect(inv).toMatchObject({ totalHT: 17.5, tva: 3.325, totalTTC: 20.825 })
    expect(inv.lines).toHaveLength(1)
  })
  it('classe l’activité', () => {
    const now = new Date('2026-10-24')
    expect(activityScore(0, null, now).status).toBe('never')
    expect(activityScore(99, new Date('2026-10-22'), now)).toMatchObject({ score: 80, status: 'active' })
    expect(activityScore(3, new Date('2026-08-01'), now).status).toBe('dormant')
  })
})

import { billingSettings, withUserPricing } from '@/lib/super-admin/billing'
describe('paramètres de facturation', () => {
  it('lit TenantModule.settings.billing', () => {
    expect(billingSettings({ billing: { seats: 4, priceOverride: 12, discountPercent: 150 } })).toEqual({ seats: 4, priceOverride: 12, discountPercent: 100 })
    expect(billingSettings({})).toEqual({ seats: 0, priceOverride: null, discountPercent: 0 })
  })
  it('ajoute la grille utilisateurs', () => {
    expect(withUserPricing({ name: 'crm' })).toMatchObject({ includedUsers: 5, pricePerUser: 2 })
  })
})
