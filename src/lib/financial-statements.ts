/**
 * États financiers — système comptable des entreprises tunisien (NC 01, modèle autorisé).
 *
 * Fonctions pures, testables sans base :
 *  - le BILAN est cumulatif (toutes les écritures validées jusqu'à la date d'arrêté) ;
 *  - l'ÉTAT DE RÉSULTAT porte sur la période (hors écriture de clôture, qui solde les classes 6 et 7).
 *
 * Conventions de signe : un solde est toujours calculé débit − crédit par compte, puis présenté
 * positivement du côté où il tombe. Les comptes de tiers (40 à 48) et de trésorerie (50 à 58) sont
 * classés compte par compte selon le sens de leur solde (un client créditeur passe au passif, une
 * banque créditrice devient un concours bancaire).
 */

export interface StatementLineInput {
  accountNumber: string
  accountName?: string
  debit: number
  credit: number
}

export interface StatementItem {
  key: string
  label: string
  gross: number
  /** Amortissements et provisions (actif uniquement), en valeur positive. */
  depreciation?: number
  net: number
}

export interface BalanceSheet {
  actif: {
    nonCourants: StatementItem[]
    totalNonCourants: number
    courants: StatementItem[]
    totalCourants: number
    total: number
  }
  passif: {
    capitauxPropres: StatementItem[]
    totalCapitauxPropres: number
    nonCourants: StatementItem[]
    totalNonCourants: number
    courants: StatementItem[]
    totalCourants: number
    totalPassifs: number
    total: number
  }
  /** Résultat des classes 6 et 7 non encore soldé par une écriture de clôture. */
  resultatNonAffecte: number
  ecart: number
  equilibre: boolean
}

export interface IncomeStatement {
  produitsExploitation: StatementItem[]
  totalProduitsExploitation: number
  chargesExploitation: StatementItem[]
  totalChargesExploitation: number
  resultatExploitation: number
  financier: StatementItem[]
  resultatActivitesOrdinairesAvantImpot: number
  impotSurBenefices: number
  resultatNet: number
}

export const r3 = (n: number) => {
  const v = Math.round((Number(n) || 0) * 1000) / 1000
  return Object.is(v, -0) ? 0 : v
}

/** Solde débit − crédit par numéro de compte. */
export function balancesByAccount(lines: StatementLineInput[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lines) {
    const k = String(l.accountNumber).trim()
    m.set(k, (m.get(k) ?? 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0))
  }
  for (const [k, v] of m) m.set(k, r3(v))
  return m
}

const sw = (acc: string, ...prefixes: string[]) => prefixes.some(p => acc.startsWith(p))

function sum(bal: Map<string, number>, pred: (acc: string, v: number) => boolean): number {
  let s = 0
  for (const [acc, v] of bal) if (pred(acc, v)) s += v
  return r3(s)
}

const item = (key: string, label: string, gross: number, depreciation?: number): StatementItem => {
  const g = r3(gross)
  const d = depreciation === undefined ? undefined : r3(depreciation)
  return { key, label, gross: g, ...(d !== undefined ? { depreciation: d } : {}), net: r3(g - (d ?? 0)) }
}

const total = (items: StatementItem[]) => r3(items.reduce((s, i) => s + i.net, 0))

/** Résultat (produits − charges) des comptes de classes 6 et 7 présents dans les soldes. */
export function resultFromBalances(bal: Map<string, number>): number {
  // classe 7 créditrice (solde négatif) − classe 6 débitrice
  return r3(-sum(bal, a => sw(a, '6', '7')))
}

export function buildBalanceSheet(lines: StatementLineInput[]): BalanceSheet {
  const bal = balancesByAccount(lines)
  const D = (pred: (a: string) => boolean) => sum(bal, (a, v) => pred(a) && v > 0)   // soldes débiteurs
  const C = (pred: (a: string) => boolean) => -sum(bal, (a, v) => pred(a) && v < 0)  // soldes créditeurs (positifs)
  const N = (pred: (a: string) => boolean) => sum(bal, a => pred(a))                 // solde net débiteur

  // ── ACTIF NON COURANT ──
  const incorp = item('immo_incorporelles', 'Immobilisations incorporelles',
    N(a => sw(a, '21')), -N(a => sw(a, '280', '281', '291')))
  const corp = item('immo_corporelles', 'Immobilisations corporelles',
    N(a => sw(a, '22', '23', '24')), -N(a => sw(a, '282', '283', '284', '292', '293', '294')))
  const fin = item('immo_financieres', 'Immobilisations financières',
    N(a => sw(a, '25', '26')), -N(a => sw(a, '295', '296', '297')))
  const autresANC = item('autres_actifs_non_courants', 'Autres actifs non courants',
    N(a => sw(a, '27')), -N(a => sw(a, '298', '299', '289')))
  const nonCourants = [incorp, corp, fin, autresANC]

  // ── ACTIF COURANT ──
  const stocks = item('stocks', 'Stocks', N(a => sw(a, '3') && !sw(a, '39')), -N(a => sw(a, '39')))
  const clients = item('clients', 'Clients et comptes rattachés', D(a => sw(a, '41')), -N(a => sw(a, '491')))
  const autresAC = item('autres_actifs_courants', 'Autres actifs courants',
    D(a => sw(a, '40', '42', '43', '44', '45', '46', '47', '48')), -N(a => sw(a, '49') && !sw(a, '491')))
  const placements = item('placements', 'Placements et autres actifs financiers', D(a => sw(a, '51', '52')), -N(a => sw(a, '59')))
  const liquidites = item('liquidites', 'Liquidités et équivalents de liquidités', D(a => sw(a, '53', '54', '55', '56', '57', '58')))
  const courants = [stocks, clients, autresAC, placements, liquidites]

  const totalNonCourants = total(nonCourants)
  const totalCourantsA = total(courants)

  // ── CAPITAUX PROPRES ──
  const resultatNonAffecte = resultFromBalances(bal)
  const cp = [
    item('capital', 'Capital social', -N(a => sw(a, '10'))),
    item('reserves', 'Réserves', -N(a => sw(a, '11'))),
    item('autres_cp', 'Autres capitaux propres', -N(a => sw(a, '14'))),
    item('resultats_reportes', 'Résultats reportés', -N(a => sw(a, '12'))),
    item('resultat_exercice', "Résultat de l'exercice", r3(-N(a => sw(a, '13')) + resultatNonAffecte)),
  ]

  // ── PASSIFS ──
  const pnc = [
    item('emprunts', 'Emprunts', -N(a => sw(a, '16'))),
    item('autres_passifs_financiers', 'Autres passifs financiers', -N(a => sw(a, '17', '18'))),
    item('provisions', 'Provisions', -N(a => sw(a, '15'))),
  ]
  const pc = [
    item('fournisseurs', 'Fournisseurs et comptes rattachés', C(a => sw(a, '40'))),
    item('autres_passifs_courants', 'Autres passifs courants', C(a => sw(a, '41', '42', '43', '44', '45', '46', '47', '48'))),
    item('concours_bancaires', 'Concours bancaires et autres passifs financiers',
      r3(-N(a => sw(a, '50')) + C(a => sw(a, '51', '52', '53', '54', '55', '56', '57', '58')))),
  ]

  const totalCP = total(cp)
  const totalPNC = total(pnc)
  const totalPC = total(pc)
  const totalActif = r3(totalNonCourants + totalCourantsA)
  const totalPassif = r3(totalCP + totalPNC + totalPC)
  const ecart = r3(totalActif - totalPassif)

  return {
    actif: { nonCourants, totalNonCourants, courants, totalCourants: totalCourantsA, total: totalActif },
    passif: {
      capitauxPropres: cp, totalCapitauxPropres: totalCP,
      nonCourants: pnc, totalNonCourants: totalPNC,
      courants: pc, totalCourants: totalPC,
      totalPassifs: r3(totalPNC + totalPC),
      total: totalPassif,
    },
    resultatNonAffecte,
    ecart,
    equilibre: Math.abs(ecart) < 0.001,
  }
}

export function buildIncomeStatement(lines: StatementLineInput[]): IncomeStatement {
  const bal = balancesByAccount(lines)
  const P = (pred: (a: string) => boolean) => -sum(bal, a => pred(a)) // produits : solde créditeur positif
  const Ch = (pred: (a: string) => boolean) => sum(bal, a => pred(a)) // charges : solde débiteur positif

  const produits = [
    item('revenus', 'Revenus', P(a => sw(a, '70'))),
    item('production_immobilisee', 'Production immobilisée', P(a => sw(a, '72'))),
    item('autres_produits_exploitation', "Autres produits d'exploitation", P(a => sw(a, '74', '79'))),
  ]
  const charges = [
    // 71 créditeur = stockage (diminue les charges), débiteur = déstockage
    item('variation_stocks', 'Variation des stocks de produits finis et des encours', Ch(a => sw(a, '71'))),
    item('achats_marchandises', 'Achats de marchandises consommés', Ch(a => sw(a, '607', '6037'))),
    item('achats_approvisionnements', "Achats d'approvisionnements consommés", Ch(a => sw(a, '60') && !sw(a, '607', '6037'))),
    item('charges_personnel', 'Charges de personnel', Ch(a => sw(a, '64'))),
    item('dotations', 'Dotations aux amortissements et aux provisions (nettes des reprises)', r3(Ch(a => sw(a, '68')) - P(a => sw(a, '78')))),
    item('autres_charges_exploitation', "Autres charges d'exploitation", Ch(a => sw(a, '61', '62', '66'))),
  ]
  const totalProduits = total(produits)
  const totalCharges = total(charges)
  const resultatExploitation = r3(totalProduits - totalCharges)

  const chargesFin = r3(Ch(a => sw(a, '65')) - P(a => sw(a, '75')))
  const gains = P(a => sw(a, '73'))
  const pertes = Ch(a => sw(a, '63'))
  const financier = [
    item('charges_financieres_nettes', 'Charges financières nettes', chargesFin),
    item('autres_gains_ordinaires', 'Autres gains ordinaires', gains),
    item('autres_pertes_ordinaires', 'Autres pertes ordinaires', pertes),
  ]
  const rao = r3(resultatExploitation - chargesFin + gains - pertes)
  const impot = Ch(a => sw(a, '69'))
  // Comptes 67 / 77 (éléments extraordinaires, s'ils existent dans le plan du dossier)
  const extra = r3(P(a => sw(a, '77')) - Ch(a => sw(a, '67')))
  const net = r3(rao - impot + extra)

  return {
    produitsExploitation: produits,
    totalProduitsExploitation: totalProduits,
    chargesExploitation: charges,
    totalChargesExploitation: totalCharges,
    resultatExploitation,
    financier,
    resultatActivitesOrdinairesAvantImpot: rao,
    impotSurBenefices: impot,
    resultatNet: net,
  }
}

export interface ClosingLine { accountNumber: string; debit: number; credit: number }

/**
 * Écriture de clôture : solde chaque compte de classe 6 et 7 et porte le résultat
 * en 131 (bénéfice) ou 135 (perte). Renvoie [] si aucun compte de gestion n'est mouvementé.
 */
export function buildClosingLines(lines: StatementLineInput[]): { lines: ClosingLine[]; result: number } {
  const bal = balancesByAccount(lines)
  const out: ClosingLine[] = []
  for (const [acc, v] of [...bal.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!sw(acc, '6', '7') || v === 0) continue
    out.push(v > 0 ? { accountNumber: acc, debit: 0, credit: v } : { accountNumber: acc, debit: r3(-v), credit: 0 })
  }
  const result = resultFromBalances(bal)
  if (out.length === 0) return { lines: [], result: 0 }
  if (result > 0) out.push({ accountNumber: '131', debit: 0, credit: result })
  else if (result < 0) out.push({ accountNumber: '135', debit: r3(-result), credit: 0 })
  return { lines: out, result }
}
