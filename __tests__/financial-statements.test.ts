import { buildBalanceSheet, buildIncomeStatement, buildClosingLines, balancesByAccount } from '@/lib/financial-statements'

const L = (accountNumber: string, debit: number, credit: number) => ({ accountNumber, debit, credit })

// Exercice type : apport en capital, achat de matériel amorti, ventes, achats, salaires, banque.
const year = [
  L('1013', 0, 10000), L('532', 10000, 0),             // capital versé en banque
  L('2234', 3000, 0), L('532', 0, 3000),               // matériel
  L('411', 11900, 0), L('707', 0, 10000), L('4366', 0, 1900), // vente TTC
  L('607', 4000, 0), L('4366', 760, 0), L('401', 0, 4760),    // achat marchandises
  L('640', 1500, 0), L('532', 0, 1500),                // salaires payés
  L('6811', 600, 0), L('2822', 0, 600),                // dotation
  L('541', 50, 0), L('532', 0, 50),
]

describe('états financiers NC 01', () => {
  it('calcule les soldes débit − crédit par compte', () => {
    const b = balancesByAccount(year)
    expect(b.get('532')).toBe(5450)
    expect(b.get('707')).toBe(-10000)
  })

  it('état de résultat : produits positifs, charges positives, résultat net', () => {
    const r = buildIncomeStatement(year)
    expect(r.totalProduitsExploitation).toBe(10000)
    expect(r.chargesExploitation.find(i => i.key === 'achats_marchandises')!.net).toBe(4000)
    expect(r.chargesExploitation.find(i => i.key === 'charges_personnel')!.net).toBe(1500)
    expect(r.chargesExploitation.find(i => i.key === 'dotations')!.net).toBe(600)
    expect(r.resultatExploitation).toBe(3900)
    expect(r.resultatNet).toBe(3900)
  })

  it('bilan équilibré, amortissement en déduction, résultat non affecté au passif', () => {
    const b = buildBalanceSheet(year)
    const corp = b.actif.nonCourants.find(i => i.key === 'immo_corporelles')!
    expect(corp).toMatchObject({ gross: 3000, depreciation: 600, net: 2400 })
    expect(b.actif.courants.find(i => i.key === 'clients')!.net).toBe(11900)
    expect(b.actif.courants.find(i => i.key === 'liquidites')!.net).toBe(5500)
    expect(b.passif.capitauxPropres.find(i => i.key === 'resultat_exercice')!.net).toBe(3900)
    expect(b.passif.courants.find(i => i.key === 'fournisseurs')!.net).toBe(4760)
    expect(b.passif.courants.find(i => i.key === 'autres_passifs_courants')!.net).toBe(1140) // TVA due
    expect(b.actif.total).toBe(19800)
    expect(b.passif.total).toBe(19800)
    expect(b.equilibre).toBe(true)
  })

  it('banque créditrice → concours bancaires ; client créditeur → autres passifs courants', () => {
    const b = buildBalanceSheet([L('532', 0, 500), L('419', 0, 200), L('1013', 700, 0)])
    expect(b.actif.courants.find(i => i.key === 'liquidites')!.net).toBe(0)
    expect(b.passif.courants.find(i => i.key === 'concours_bancaires')!.net).toBe(500)
    expect(b.passif.courants.find(i => i.key === 'autres_passifs_courants')!.net).toBe(200)
  })

  it('écriture de clôture : solde 6/7, bénéfice en 131, équilibrée', () => {
    const { lines, result } = buildClosingLines(year)
    expect(result).toBe(3900)
    const d = lines.reduce((s, l) => s + l.debit, 0)
    const c = lines.reduce((s, l) => s + l.credit, 0)
    expect(Math.round((d - c) * 1000)).toBe(0)
    expect(lines.find(l => l.accountNumber === '131')).toEqual({ accountNumber: '131', debit: 0, credit: 3900 })
    expect(lines.some(l => l.accountNumber.startsWith('4'))).toBe(false)

    // Après clôture, le bilan reste équilibré et le résultat est porté en 13
    const after = buildBalanceSheet([...year, ...lines])
    expect(after.resultatNonAffecte).toBe(0)
    expect(after.passif.capitauxPropres.find(i => i.key === 'resultat_exercice')!.net).toBe(3900)
    expect(after.equilibre).toBe(true)
  })

  it('perte → 135 au débit', () => {
    const { lines, result } = buildClosingLines([L('640', 800, 0), L('532', 0, 800)])
    expect(result).toBe(-800)
    expect(lines.find(l => l.accountNumber === '135')).toEqual({ accountNumber: '135', debit: 800, credit: 0 })
  })

  it('aucun compte de gestion → pas d’écriture de clôture', () => {
    expect(buildClosingLines([L('1013', 0, 100), L('532', 100, 0)])).toEqual({ lines: [], result: 0 })
  })
})
