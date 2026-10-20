jest.mock('@/lib/db', () => ({ prisma: {} }))
import { generateTEJXml, recordToCertificate, tejFilename, tejText, categorieFromMatricule } from '@/lib/tej-generator'

const base = {
  id: 'wt1', tejId: 'TEJ-202605-1234567A-0001', beneficiaryTin: '7654321Y/A/M/000', beneficiaryName: 'Société Étoile & Fils',
  beneficiaryAddress: 'Rue de Marseille, Tunis', beneficiaryType: 'SOCIETE', beneficiaryRegime: 'IS_20',
  beneficiaryEmail: 'contact@etoile.tn', beneficiaryPhone: '71000000', serviceType: 'PRESTATION_SERVICE',
  grossAmount: 2380, vatRate: 19, taxAmount: 23.8, rate: 0.01, paymentDate: new Date(Date.UTC(2026, 4, 15)), periodYear: 2026,
  invoice: null,
}

describe('Fichier TEJ (CCT-RS-V2)', () => {
  test('certificat complet → structure DeclarationsRS', () => {
    const { cert, missing } = recordToCertificate(base)
    expect(missing).toEqual([])
    const xml = generateTEJXml({ identifiant: '1234567A', categorie: 'PM' }, 2026, 5, [cert!])
    expect(xml).toContain('<DeclarationsRS ')
    expect(xml).toContain('VersionSchema="1.0"')
    expect(xml).toContain('<Identifiant>1234567A</Identifiant>')
    expect(xml).toContain('<ActeDepot>0</ActeDepot>')
    expect(xml).toContain('<MoisDepot>05</MoisDepot>')
    expect(xml).toContain('<Identifiant>7654321Y</Identifiant>')
    expect(xml).toContain('<CategorieContribuable>PM</CategorieContribuable>')
    expect(xml).toContain('<DatePayement>15/05/2026</DatePayement>')
    expect(xml).toContain('IdTypeOperation="RS7_000002"')
    expect(xml).toContain('<MontantHT>2000000</MontantHT>')
    expect(xml).toContain('<MontantTVA>380000</MontantTVA>')
    expect(xml).toContain('<MontantTTC>2380000</MontantTTC>')
    expect(xml).toContain('<TauxRS>1.00</TauxRS>')
    expect(xml).toContain('<MontantRS>23800</MontantRS>')
    expect(xml).toContain('<MontantNetServi>2356200</MontantNetServi>')
    expect(xml).not.toMatch(/[éèà&]|<!--/)
  })

  test('champs obligatoires manquants → pas de certificat', () => {
    const { cert, missing } = recordToCertificate({ ...base, beneficiaryEmail: null, beneficiaryTin: null, paymentDate: null })
    expect(cert).toBeUndefined()
    expect(missing).toEqual(expect.arrayContaining(['email', 'matricule fiscal', 'date de paiement']))
  })

  test('nom de fichier, texte et catégorie', () => {
    expect(tejFilename('1234567A', 2026, 5)).toBe('1234567A-2026-05-0.xml')
    expect(tejText('Étoile & Fils; *test*')).toBe('Etoile et Fils test')
    expect(categorieFromMatricule('1234567A/B/M/000')).toBe('PM')
    expect(categorieFromMatricule('1234567A/B/P/000')).toBe('PP')
  })
})
