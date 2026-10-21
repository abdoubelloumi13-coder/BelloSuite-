/**
 * IRPP fiscal rules unit tests — Tunisia salary tax
 */

import { validateIRPP } from './helpers.utils'
import { calculateInvoiceTotals } from '@/lib/fiscal'

describe('Tunisia IRPP — Tax Brackets', () => {
  it('tax on 10000 TND/month (first bracket 5000-15000 at 15%)', () => {
    const tax = validateIRPP(10000, 0, false)
    // 5000 × 0 = 0 + 5000 × 0.15 = 750 / 12 = 62.5
    expect(tax).toBe(63) // rounded
  })

  it('tax on 30000 TND/month (0-5000: 0%, 5000-15000: 15%, 15000-30000: 20%)', () => {
    const tax = validateIRPP(30000, 0, false)
    expect(tax).toBeGreaterThan(300)
  })

  it('children deduction: 150 TND per child/month', () => {
    const noChildren = validateIRPP(30000, 0, false)
    const with2 = validateIRPP(30000, 2, false)
    expect(noChildren - with2).toBeGreaterThanOrEqual(25) // 2 × 150 / 12 ≈ 25
  })

  it('married deduction: 300 TND/month', () => {
    const single = validateIRPP(25000, 0, false)
    const married = validateIRPP(25000, 0, true)
    expect(married).toBeLessThan(single)
  })

  it('never returns negative tax', () => {
    expect(validateIRPP(6000, 10, true)).toBeGreaterThanOrEqual(0)
    expect(validateIRPP(2000, 5, true)).toBe(0)
  })

  it('high salary bracket 35% for 70000+', () => {
    const tax = validateIRPP(80000, 0, false)
    // 80000: 5000×0% + 10000×15% + 15000×20% + 20000×25% + 20000×30% + 10000×35% = 16250/year → 1354/month
    // Children/married deductions further reduce it
    expect(tax).toBeGreaterThan(1000) // at least crosses 35% bracket
  })
})
describe('calculateInvoiceTotals — case « Timbre fiscal »', () => {
  const lines = [{ quantity: 1, unitPriceHT: 100, discount: 0, vatRate: 19, fodecApply: false }]
  it('par défaut : timbre 1,000 DT inclus dans le TTC (comportement historique)', () => {
    const t = calculateInvoiceTotals(lines as never)
    expect(t.timbreFiscal).toBe(1)
    expect(t.totalTTC).toBeCloseTo(120, 3)
  })
  it('décoché : timbre 0 et TTC sans timbre', () => {
    const t = calculateInvoiceTotals(lines as never, { applyStamp: false })
    expect(t.timbreFiscal).toBe(0)
    expect(t.totalTTC).toBeCloseTo(119, 3)
  })
})
