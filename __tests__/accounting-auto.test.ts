import { buildAutoEntryLines, JOURNALIZATION_RULES } from '@/lib/accounting-auto'
import { TUNISIAN_CHART_OF_ACCOUNTS, TN_ACCOUNTS, findChartAccount } from '@/lib/tunisian-chart-of-accounts'

describe('plan comptable tunisien', () => {
  it('contient les comptes clés avec le bon type', () => {
    const expect_ = (n: string, type: string) => expect(findChartAccount(n)?.type).toBe(type)
    expect_('4366', 'ASSET')
    expect_('4367', 'LIABILITY')
    expect_('432', 'LIABILITY')
    expect_('4342', 'LIABILITY')
    expect_('431', 'LIABILITY')
    expect_('4371', 'LIABILITY')
    expect_('665', 'EXPENSE')
  })
  it('tous les comptes TN_ACCOUNTS existent dans le plan et aucun numéro n\'est dupliqué', () => {
    for (const n of Object.values(TN_ACCOUNTS)) expect(findChartAccount(n)).toBeDefined()
    const nums = TUNISIAN_CHART_OF_ACCOUNTS.map(a => a.accountNumber)
    expect(new Set(nums).size).toBe(nums.length)
  })
  it('aucune règle n\'utilise de compte français (4111, 4457, 3410, 6110)', () => {
    const used = Object.values(JOURNALIZATION_RULES).flatMap(r => r.lines.map(l => l.accountPrefix))
    for (const fr of ['4111', '4457', '3410', '6110', '4360']) expect(used).not.toContain(fr)
  })
})

describe('buildAutoEntryLines', () => {
  it('facture : 411 / 707, 4371, 4367, 4368 équilibrée', () => {
    const r = buildAutoEntryLines({ type: 'INVOICE', totalTTC: 1213.19, subtotalHT: 1000, totalFodec: 10, totalVAT: 202.19, timbreFiscal: 1 })
    expect(r.balanced).toBe(true)
    expect(r.lines.map(l => [l.account, l.debit, l.credit])).toEqual([
      ['411', 1213.19, 0], ['707', 0, 1000], ['4371', 0, 10], ['4367', 0, 202.19], ['4368', 0, 1],
    ])
  })
  it('service → 705 ; lignes nulles omises', () => {
    const r = buildAutoEntryLines({ type: 'INVOICE_SERVICE', totalTTC: 120, subtotalHT: 100, totalFodec: 0, totalVAT: 19, timbreFiscal: 1 })
    expect(r.lines.map(l => l.account)).toEqual(['411', '705', '4367', '4368'])
    expect(r.balanced).toBe(true)
  })
  it('avoir : timbre non restitué, montant client recalculé', () => {
    const r = buildAutoEntryLines({ type: 'CREDIT_NOTE', totalTTC: 120, subtotalHT: 100, totalFodec: 0, totalVAT: 19, timbreFiscal: 1 })
    expect(r.lines.find(l => l.account === '411')?.credit).toBe(119)
    expect(r.balanced).toBe(true)
  })
  it('incohérence > 5 millimes signalée', () => {
    expect(buildAutoEntryLines({ type: 'INVOICE', totalTTC: 130, subtotalHT: 100, totalVAT: 19, timbreFiscal: 1 }).balanced).toBe(false)
  })
  it('devis : aucune ligne', () => {
    expect(buildAutoEntryLines({ type: 'QUOTE', totalTTC: 10 }).lines).toEqual([])
  })
})
