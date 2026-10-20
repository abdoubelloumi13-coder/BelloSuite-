import { writeFileSync, mkdirSync } from 'fs'
import { generateTEIFXml, teifMatricule, teifDate, validateTEIFData, TEIFValidationError, type TEIFData } from '@/lib/teif-generator'

const base: TEIFData = {
  invoiceNumber: 'FAC-2026-0042',
  type: 'INVOICE',
  issueDate: '2026-10-20',
  dueDate: '2026-11-19',
  tenant: { name: 'BelloSuite SARL & Co', matriculeFiscal: '1234567/A/A/M/000', address: 'Rue de Marseille', city: 'Tunis', zipCode: '1000' },
  client: { name: 'Client Test', matriculeFiscal: '7654321KNC000', address: 'Av. Habib Bourguiba', city: 'Sfax' },
  items: [
    { description: 'Prestation conseil', quantity: 2, unitPriceHT: 500, totalHT: 1000, vatRate: 19, vatAmount: 190, fodecApply: false },
    { description: 'Pièces <spéciales>', quantity: 1, unitPriceHT: 100, totalHT: 100, vatRate: 7, fodecApply: true, fodecAmount: 1, vatAmount: 7.07 },
  ],
  totals: { subtotalHT: 1100, totalFodec: 1, totalVAT: 197.07, timbreFiscal: 1, totalTTC: 1299.07, vatSummary: {} },
}

describe('TEIF 1.8.8', () => {
  test('identifiants et dates', () => {
    expect(teifMatricule('1234567/A/A/M/000')).toBe('1234567AAM000')
    expect(teifMatricule('1234567A')).toBeNull()
    expect(teifDate('2026-10-20')).toBe('201026')
  })

  test('structure et montants', () => {
    const xml = generateTEIFXml(base)
    if (process.env.TEIF_SAMPLE_OUT) { mkdirSync('tmp', { recursive: true }); writeFileSync(process.env.TEIF_SAMPLE_OUT, xml) }
    expect(xml).toContain('<TEIF version="1.8.8" controlingAgency="TTN">')
    expect(xml).toContain('<MessageSenderIdentifier type="I-01">1234567AAM000</MessageSenderIdentifier>')
    expect(xml).toContain('<DocumentType code="I-11">Facture</DocumentType>')
    expect(xml).toContain('<DateText format="ddMMyy" functionCode="I-31">201026</DateText>')
    expect(xml).toContain('<PartnerDetails functionCode="I-62">')
    expect(xml).toContain('<PartnerDetails functionCode="I-64">')
    expect(xml).toContain('<TaxTypeName code="I-162">FODEC</TaxTypeName>')
    expect(xml).toContain('<TaxTypeName code="I-1601">Droit de timbre</TaxTypeName>')
    expect(xml).toMatch(/amountTypeCode="I-180"[^>]*><Amount currencyIdentifier="TND">1299\.070</)
    expect(xml).toContain('&amp; Co')
    expect(xml).toContain('&lt;spéciales&gt;')
  })

  test('avoir et note d’honoraires', () => {
    expect(generateTEIFXml({ ...base, type: 'CREDIT_NOTE' })).toContain('code="I-12"')
    expect(generateTEIFXml({ ...base, type: 'INVOICE_HONORARY' })).toContain('code="I-13"')
  })

  test('refuse un matricule incomplet ou un total faux', () => {
    expect(validateTEIFData({ ...base, tenant: { ...base.tenant, matriculeFiscal: '1234567A' } })[0]).toMatch(/13 caractères/)
    expect(() => generateTEIFXml({ ...base, totals: { ...base.totals, totalTTC: 1300 } })).toThrow(TEIFValidationError)
  })
})
