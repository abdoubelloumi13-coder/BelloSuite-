export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export interface ChartOfAccountNode {
  accountNumber: string;
  name: string;
  type: AccountType;
}

export const TUNISIAN_CHART_OF_ACCOUNTS: ChartOfAccountNode[] = [
  // CLASSE 1 : Capitaux propres et passifs non courants
  { accountNumber: '10', name: 'Capital', type: 'EQUITY' },
  { accountNumber: '101', name: 'Capital social', type: 'EQUITY' },
  { accountNumber: '1011', name: 'Capital souscrit - non appelé', type: 'EQUITY' },
  { accountNumber: '1012', name: 'Capital souscrit - appelé, non versé', type: 'EQUITY' },
  { accountNumber: '1013', name: 'Capital souscrit - appelé, versé', type: 'EQUITY' },
  { accountNumber: '105', name: 'Fonds de dotation', type: 'EQUITY' },
  { accountNumber: '108', name: "Compte de l'exploitant", type: 'EQUITY' },
  { accountNumber: '11', name: 'Réserves et primes liées au capital', type: 'EQUITY' },
  { accountNumber: '111', name: 'Réserve légale', type: 'EQUITY' },
  { accountNumber: '112', name: 'Réserves statutaires', type: 'EQUITY' },
  { accountNumber: '117', name: 'Primes liées au capital', type: 'EQUITY' },
  { accountNumber: '12', name: 'Résultats reportés', type: 'EQUITY' },
  { accountNumber: '121', name: 'Résultats reportés', type: 'EQUITY' },
  { accountNumber: '13', name: "Résultat de l'exercice", type: 'EQUITY' },
  { accountNumber: '131', name: 'Résultat bénéficiaire', type: 'EQUITY' },
  { accountNumber: '135', name: 'Résultat déficitaire', type: 'EQUITY' },
  { accountNumber: '14', name: 'Autres capitaux propres', type: 'EQUITY' },
  { accountNumber: '145', name: "Subventions d'investissement", type: 'EQUITY' },
  { accountNumber: '15', name: 'Provisions pour risques & charges', type: 'LIABILITY' },
  { accountNumber: '151', name: 'Provisions pour risques', type: 'LIABILITY' },
  { accountNumber: '155', name: 'Provisions pour impôts', type: 'LIABILITY' },
  { accountNumber: '16', name: 'Emprunts & dettes assimilées', type: 'LIABILITY' },
  { accountNumber: '162', name: 'Emprunts auprès des établissements financiers', type: 'LIABILITY' },
  { accountNumber: '18', name: 'Autres passifs non courants', type: 'LIABILITY' },

  // CLASSE 2 : Actifs non courants
  { accountNumber: '21', name: 'Immobilisations incorporelles', type: 'ASSET' },
  { accountNumber: '212', name: 'Concessions de marques, brevets, licences', type: 'ASSET' },
  { accountNumber: '213', name: 'Logiciels', type: 'ASSET' },
  { accountNumber: '214', name: 'Fonds commercial', type: 'ASSET' },
  { accountNumber: '22', name: 'Immobilisations corporelles', type: 'ASSET' },
  { accountNumber: '221', name: 'Terrains', type: 'ASSET' },
  { accountNumber: '222', name: 'Constructions', type: 'ASSET' },
  { accountNumber: '223', name: 'Installations techniques, matériel et outillage industriels', type: 'ASSET' },
  { accountNumber: '224', name: 'Matériel de transport', type: 'ASSET' },
  { accountNumber: '228', name: 'Autres immobilisations corporelles (bureau, info)', type: 'ASSET' },
  { accountNumber: '23', name: 'Immobilisations en cours', type: 'ASSET' },
  { accountNumber: '25', name: 'Participations & créances liées à des participations', type: 'ASSET' },
  { accountNumber: '26', name: 'Autres immobilisations financières', type: 'ASSET' },
  { accountNumber: '27', name: 'Autres actifs non courants', type: 'ASSET' },
  { accountNumber: '28', name: 'Amortissements des immobilisations', type: 'ASSET' },
  { accountNumber: '281', name: 'Amortissements des immobilisations incorporelles', type: 'ASSET' },
  { accountNumber: '282', name: 'Amortissements des immobilisations corporelles', type: 'ASSET' },
  { accountNumber: '29', name: 'Provisions pour dépréciation des actifs immobilisés', type: 'ASSET' },

  // CLASSE 3 : Comptes de stocks
  { accountNumber: '31', name: 'Matières premières & fournitures liées', type: 'ASSET' },
  { accountNumber: '32', name: 'Autres approvisionnements', type: 'ASSET' },
  { accountNumber: '33', name: 'En-cours de production de biens', type: 'ASSET' },
  { accountNumber: '34', name: 'En-cours de production de services', type: 'ASSET' },
  { accountNumber: '35', name: 'Stocks de produits', type: 'ASSET' },
  { accountNumber: '355', name: 'Produits finis', type: 'ASSET' },
  { accountNumber: '37', name: 'Stocks de marchandises', type: 'ASSET' },
  { accountNumber: '39', name: 'Provisions pour dépréciation des stocks', type: 'ASSET' },

  // CLASSE 4 : Comptes de tiers
  { accountNumber: '40', name: 'Fournisseurs & comptes rattachés', type: 'LIABILITY' },
  { accountNumber: '401', name: "Fournisseurs d'exploitation", type: 'LIABILITY' },
  { accountNumber: '404', name: "Fournisseurs d'immobilisations", type: 'LIABILITY' },
  { accountNumber: '408', name: 'Fournisseurs - factures non parvenues', type: 'LIABILITY' },
  { accountNumber: '409', name: 'Fournisseurs débiteurs (avances)', type: 'ASSET' },
  { accountNumber: '41', name: 'Clients & comptes rattachés', type: 'ASSET' },
  { accountNumber: '411', name: 'Clients', type: 'ASSET' },
  { accountNumber: '413', name: 'Clients - effets à recevoir', type: 'ASSET' },
  { accountNumber: '416', name: 'Clients douteux ou litigieux', type: 'ASSET' },
  { accountNumber: '418', name: 'Clients - produits non encore facturés', type: 'ASSET' },
  { accountNumber: '419', name: 'Clients créditeurs (avances)', type: 'LIABILITY' },
  { accountNumber: '42', name: 'Personnel & comptes rattachés', type: 'LIABILITY' },
  { accountNumber: '421', name: 'Personnel - avances et acomptes', type: 'ASSET' },
  { accountNumber: '425', name: 'Personnel - rémunérations dues', type: 'LIABILITY' },
  { accountNumber: '43', name: 'Etat & collectivités publiques', type: 'LIABILITY' },
  { accountNumber: '431', name: 'Etat - cotisations sociales (CNSS) à payer', type: 'LIABILITY' },
  { accountNumber: '432', name: 'Etat, impôts et taxes retenus à la source', type: 'LIABILITY' },
  { accountNumber: '434', name: 'Etat - impôts sur les bénéfices', type: 'LIABILITY' },
  { accountNumber: '4341', name: 'Etat - retenues à la source subies (à imputer sur l\'impôt)', type: 'ASSET' },
  { accountNumber: '4342', name: 'Etat - retenues à la source sur salaires (IRPP)', type: 'LIABILITY' },
  { accountNumber: '436', name: 'Etat - taxes sur le chiffre d\'affaires (TVA)', type: 'LIABILITY' },
  { accountNumber: '4365', name: 'Taxes sur le chiffre d\'affaires à décaisser (TVA à payer)', type: 'LIABILITY' },
  { accountNumber: '4366', name: 'TVA déductible', type: 'ASSET' },
  { accountNumber: '4367', name: 'TVA collectée', type: 'LIABILITY' },
  { accountNumber: '4368', name: 'Etat - droit de timbre collecté à reverser', type: 'LIABILITY' },
  { accountNumber: '437', name: 'Etat - autres impôts, taxes et versements assimilés', type: 'LIABILITY' },
  { accountNumber: '4371', name: 'Etat - FODEC à payer', type: 'LIABILITY' },
  { accountNumber: '45', name: 'Débiteurs divers & créditeurs divers', type: 'ASSET' }, // Can be both, let's default to ASSET
  { accountNumber: '453', name: 'Sécurité sociale (CNSS)', type: 'LIABILITY' },

  // CLASSE 5 : Comptes financiers
  { accountNumber: '50', name: 'Emprunts et autres dettes financières courants', type: 'LIABILITY' },
  { accountNumber: '506', name: 'Concours bancaires courants', type: 'LIABILITY' },
  { accountNumber: '51', name: 'Prêts et autres créances financières courants', type: 'ASSET' },
  { accountNumber: '52', name: 'Placements courants', type: 'ASSET' },
  { accountNumber: '53', name: 'Banques, établissements financiers et assimilés', type: 'ASSET' },
  { accountNumber: '532', name: 'Banques', type: 'ASSET' },
  { accountNumber: '54', name: 'Caisse', type: 'ASSET' },
  { accountNumber: '541', name: 'Caisse siège social', type: 'ASSET' },

  // CLASSE 6 : Comptes de charges
  { accountNumber: '60', name: 'Achats', type: 'EXPENSE' },
  { accountNumber: '601', name: 'Achats stockés - Matières premières et fournitures', type: 'EXPENSE' },
  { accountNumber: '602', name: 'Achats stockés - Autres approvisionnements', type: 'EXPENSE' },
  { accountNumber: '604', name: 'Achats d’études et de prestations de services', type: 'EXPENSE' },
  { accountNumber: '607', name: 'Achats de marchandises', type: 'EXPENSE' },
  { accountNumber: '609', name: 'Rabais, remises et ristournes obtenus', type: 'EXPENSE' },
  { accountNumber: '61', name: 'Services extérieurs', type: 'EXPENSE' },
  { accountNumber: '613', name: 'Locations', type: 'EXPENSE' },
  { accountNumber: '615', name: 'Entretien et réparations', type: 'EXPENSE' },
  { accountNumber: '616', name: 'Primes d\'assurances', type: 'EXPENSE' },
  { accountNumber: '62', name: 'Autres services extérieurs', type: 'EXPENSE' },
  { accountNumber: '622', name: 'Rémunération d\'intermédiaires et honoraires', type: 'EXPENSE' },
  { accountNumber: '623', name: 'Publicité, publications, relations publiques', type: 'EXPENSE' },
  { accountNumber: '624', name: 'Transports de biens et transports collectifs', type: 'EXPENSE' },
  { accountNumber: '625', name: 'Déplacements, missions et réceptions', type: 'EXPENSE' },
  { accountNumber: '626', name: 'Frais postaux et télécommunications', type: 'EXPENSE' },
  { accountNumber: '627', name: 'Services bancaires et assimilés', type: 'EXPENSE' },
  { accountNumber: '63', name: 'Charges diverses ordinaires', type: 'EXPENSE' },
  { accountNumber: '64', name: 'Charges de personnel', type: 'EXPENSE' },
  { accountNumber: '640', name: 'Salaires et compléments de salaires', type: 'EXPENSE' },
  { accountNumber: '647', name: 'Charges sociales légales (CNSS)', type: 'EXPENSE' },
  { accountNumber: '65', name: 'Charges financières', type: 'EXPENSE' },
  { accountNumber: '651', name: 'Charges d\'intérêts', type: 'EXPENSE' },
  { accountNumber: '66', name: 'Impôts, taxes et versements assimilés', type: 'EXPENSE' },
  { accountNumber: '661', name: 'Impôts et taxes sur rémunérations (TFP, FOPROLOS)', type: 'EXPENSE' },
  { accountNumber: '665', name: 'Autres impôts et taxes (Timbre fiscal)', type: 'EXPENSE' },
  { accountNumber: '68', name: 'Dotations aux amortissements et aux provisions', type: 'EXPENSE' },
  { accountNumber: '69', name: 'Impôts sur les bénéfices', type: 'EXPENSE' },

  // CLASSE 7 : Comptes de produits
  { accountNumber: '70', name: 'Ventes de produits, prestations, marchandises', type: 'REVENUE' },
  { accountNumber: '701', name: 'Ventes de produits finis', type: 'REVENUE' },
  { accountNumber: '704', name: 'Travaux', type: 'REVENUE' },
  { accountNumber: '705', name: 'Etudes et prestations de services', type: 'REVENUE' },
  { accountNumber: '707', name: 'Ventes de marchandises', type: 'REVENUE' },
  { accountNumber: '709', name: 'Rabais, remises et ristournes accordés', type: 'REVENUE' },
  { accountNumber: '71', name: 'Production stockée (ou destockage)', type: 'REVENUE' },
  { accountNumber: '72', name: 'Production immobilisée', type: 'REVENUE' },
  { accountNumber: '73', name: 'Produits divers ordinaires', type: 'REVENUE' },
  { accountNumber: '74', name: 'Subventions d\'exploitation et d\'équilibre', type: 'REVENUE' },
  { accountNumber: '75', name: 'Produits financiers', type: 'REVENUE' },
  { accountNumber: '756', name: 'Gains de change', type: 'REVENUE' },
  { accountNumber: '78', name: 'Reprises sur amortissements et provisions', type: 'REVENUE' },
  { accountNumber: '79', name: 'Transferts de charges', type: 'REVENUE' }
];

/**
 * Comptes du plan comptable tunisien utilisés par les écritures automatiques (ventes, achats, paie, TVA, RS).
 * Source unique : accounting-auto, services/accounting et purchase-review s'y réfèrent.
 */
export const TN_ACCOUNTS = {
  CLIENTS: '411',
  SUPPLIERS: '401',
  SALES_GOODS: '707',
  SALES_SERVICES: '705',
  SALES_DISCOUNTS: '709',
  PURCHASES_GOODS: '607',
  PURCHASES_SERVICES: '604',
  VAT_PAYABLE: '4365',
  VAT_DEDUCTIBLE: '4366',
  VAT_COLLECTED: '4367',
  STAMP_COLLECTED: '4368',
  FODEC: '4371',
  WITHHOLDING: '432',
  /** RS subie sur nos factures de vente (opérée par le client) : créance sur l'État */
  WITHHOLDING_SUFFERED: '4341',
  PAYROLL_WITHHOLDING: '4342',
  CNSS: '431',
  STAMP_EXPENSE: '665',
  SALARIES: '640',
  EMPLOYER_SOCIAL: '647',
  PERSONNEL_DUE: '425',
  BANK: '532',
  CASH: '541',
} as const

export type TnAccountNumber = (typeof TN_ACCOUNTS)[keyof typeof TN_ACCOUNTS]

/** Libellé et type d'un compte du plan (pour le créer à la volée s'il manque chez le tenant). */
export function findChartAccount(accountNumber: string): ChartOfAccountNode | undefined {
  return TUNISIAN_CHART_OF_ACCOUNTS.find(a => a.accountNumber === accountNumber)
}

export function getAccountHierarchy() {
  const accountMap = new Map<string, ChartOfAccountNode & { children: any[] }>();
  
  // Sort accounts by number to guarantee parents are processed before children
  const sortedAccounts = [...TUNISIAN_CHART_OF_ACCOUNTS].sort((a, b) => a.accountNumber.localeCompare(b.accountNumber));
  
  const rootAccounts: any[] = [];

  sortedAccounts.forEach(account => {
    const node = { ...account, children: [] };
    accountMap.set(node.accountNumber, node);

    // Find parent (longest matching prefix)
    let parentFound = false;
    for (let i = node.accountNumber.length - 1; i > 0; i--) {
      const parentNum = node.accountNumber.substring(0, i);
      if (accountMap.has(parentNum)) {
        accountMap.get(parentNum)!.children.push(node);
        parentFound = true;
        break;
      }
    }

    if (!parentFound) {
      rootAccounts.push(node);
    }
  });

  return rootAccounts;
}
