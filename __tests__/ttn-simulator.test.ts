import { generateTEIFXml, type TEIFData } from '@/lib/teif-generator'
import { signTeifXml, verifyTeifSignature, LocalTestSigner } from '@/lib/einvoice/xades-signer'
import {
  simulateTtnSubmission, verifyValidatedTeif, verifyTtnSeal, verifyQrPayload, buildQrPayload,
  simulatedTtnReference, ttnReferenceDate, checkTeifRequiredFields,
} from '@/lib/einvoice/ttn-simulator'
import { parseXml, findElements, isDs } from '@/lib/einvoice/xml-dsig'

const base: TEIFData = {
  invoiceNumber: 'FAC-2026-0042',
  type: 'INVOICE',
  issueDate: '2026-10-20',
  tenant: { name: 'BelloSuite SARL', matriculeFiscal: '1234567AAM000', address: 'Rue de Marseille', city: 'Tunis', zipCode: '1000' },
  client: { name: 'Client Test', matriculeFiscal: '7654321KNC000', address: 'Av. Habib Bourguiba', city: 'Sfax' },
  items: [
    { description: 'Prestation conseil', quantity: 2, unitPriceHT: 500, totalHT: 1000, vatRate: 19, vatAmount: 190 },
    { description: 'Pièces', quantity: 1, unitPriceHT: 100, totalHT: 100, vatRate: 7, fodecApply: true, fodecAmount: 1, vatAmount: 7.07 },
  ],
  totals: { subtotalHT: 1100, totalFodec: 1, totalVAT: 197.07, timbreFiscal: 1, totalTTC: 1299.07, vatSummary: {} },
}

// 21/10/2026 08:05 UTC = 09:05 à Tunis (UTC+1)
const NOW = new Date(Date.UTC(2026, 9, 21, 8, 5, 0))

describe('Simulateur TTN El Fatoora', () => {
  let signed: string
  beforeAll(async () => {
    signed = (await signTeifXml(generateTEIFXml(base), new LocalTestSigner(), { signingTime: new Date(Date.UTC(2026, 9, 21, 8, 0, 0)) })).xml
  })

  test('date de référence ddMMyyHHmm en heure de Tunis', () => {
    expect(ttnReferenceDate(NOW)).toBe('2110260905')
    // passage de minuit UTC → jour suivant à Tunis
    expect(ttnReferenceDate(new Date(Date.UTC(2026, 11, 31, 23, 30)))).toBe('0101270030')
  })

  test('référence déterministe TTN-SIM-yyyymmdd-MF7-nnnnnn', () => {
    const a = simulatedTtnReference('QUJD', '1234567AAM000', NOW)
    expect(a).toMatch(/^TTN-SIM-20261021-1234567-\d{6}$/)
    expect(simulatedTtnReference('QUJD', '1234567AAM000', NOW)).toBe(a)
    expect(simulatedTtnReference('QUJE', '1234567AAM000', NOW)).not.toBe(a)
  })

  test('dépôt accepté : RefTtnVal, QR, SigCEv et SigTTN valides', async () => {
    const r = await simulateTtnSubmission(signed, { now: NOW })
    expect(r.errors).toEqual([])
    expect(r.accepted).toBe(true)
    expect(r.referenceTTN).toMatch(/^TTN-SIM-20261021-1234567-\d{6}$/)
    expect(r.referenceDate).toBe('2110260905')
    expect(r.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(r.qrPayload!.split('|').slice(0, 4)).toEqual([r.referenceTTN, '1234567AAM000', '2110260905', '1299.070'])
    expect(verifyQrPayload(r.qrPayload!).valid).toBe(true)

    const xml = r.validatedXml!
    const doc = parseXml(xml)
    const ref = findElements(doc, el => el.localName === 'RefTtnVal')[0]
    expect(Array.from(ref.childNodes).map(n => (n as Element).localName)).toEqual(['ReferenceTTN', 'ReferenceCEV', 'ReferenceDate'])
    expect(xml).toContain(`<ReferenceTTN refID="I-88">${r.referenceTTN}</ReferenceTTN>`)
    expect(xml).toContain('<DateText format="ddMMyyHHmm" functionCode="I-37">2110260905</DateText>')
    // Ordre : ... InvoiceBody, RefTtnVal, SigFrs, SigCEv, SigTTN
    const kids = Array.from(doc.documentElement.childNodes).filter(n => n.nodeType === 1) as Element[]
    expect(kids.map(k => k.getAttribute('Id') || k.localName)).toEqual(['InvoiceHeader', 'InvoiceBody', 'RefTtnVal', 'SigFrs', 'SigCEv', 'SigTTN'])

    expect(verifyTeifSignature(xml).valid).toBe(true)
    expect(verifyTtnSeal(xml, 'SigCEv')).toEqual({ valid: true, errors: [] })
    expect(verifyTtnSeal(xml, 'SigTTN')).toEqual({ valid: true, errors: [] })
    expect(verifyValidatedTeif(xml).valid).toBe(true)
  })

  test('référence identique pour un même dépôt (déterminisme)', async () => {
    const a = await simulateTtnSubmission(signed, { now: NOW })
    const b = await simulateTtnSubmission(signed, { now: NOW })
    expect(a.referenceTTN).toBe(b.referenceTTN)
    expect(a.qrPayload).toBe(b.qrPayload)
  })

  test('altération après validation → cachets invalides', async () => {
    const r = await simulateTtnSubmission(signed, { now: NOW })
    const tamperedRef = r.validatedXml!.replace(r.referenceTTN!, 'TTN-SIM-20261021-1234567-000000')
    expect(verifyTtnSeal(tamperedRef, 'SigCEv').valid).toBe(false)
    expect(verifyTtnSeal(tamperedRef, 'SigTTN').valid).toBe(false)
    expect(verifyTeifSignature(tamperedRef).valid).toBe(true) // SigFrs exclut RefTtnVal
  })

  test('rejets : non signé, signature altérée, déjà validé, XML mal formé', async () => {
    const unsigned = await simulateTtnSubmission(generateTEIFXml(base), { now: NOW })
    expect(unsigned.accepted).toBe(false)
    expect(unsigned.errors.join(' ')).toMatch(/Signature fournisseur/)

    const tampered = await simulateTtnSubmission(signed.replace('Client Test', 'Client Modifié'), { now: NOW })
    expect(tampered.accepted).toBe(false)
    expect(tampered.errors.join(' ')).toMatch(/modifié après signature/)

    const ok = await simulateTtnSubmission(signed, { now: NOW })
    const again = await simulateTtnSubmission(ok.validatedXml!, { now: NOW })
    expect(again.accepted).toBe(false)
    expect(again.errors[0]).toMatch(/déjà validée/)

    const bad = await simulateTtnSubmission('<TEIF><a></TEIF>')
    expect(bad.accepted).toBe(false)
    expect(bad.errors[0]).toMatch(/XML mal formé/)
  })

  test('champs obligatoires TEIF manquants détectés', () => {
    const xml = generateTEIFXml(base)
      .replace(/<DocumentIdentifier>[^<]*<\/DocumentIdentifier>/, '<DocumentIdentifier></DocumentIdentifier>')
      .replace(/<PartnerDetails functionCode="I-64">[\s\S]*?<\/PartnerDetails>/, '')
      .replace('<Amount currencyIdentifier="TND">1299.070</Amount>', '<Amount currencyIdentifier="TND">1300.000</Amount>')
    const { errors } = checkTeifRequiredFields(parseXml(xml))
    expect(errors.some(e => /DocumentIdentifier/.test(e))).toBe(true)
    expect(errors.some(e => /I-64/.test(e))).toBe(true)
    expect(errors.some(e => /incohérents/.test(e))).toBe(true)
    expect(checkTeifRequiredFields(parseXml(generateTEIFXml(base))).errors).toEqual([])
  })

  test('QR : HMAC dépend du secret EINVOICE_SIM_HMAC_SECRET', () => {
    const f = { reference: 'TTN-SIM-20261021-1234567-000001', matriculeFiscal: '1234567AAM000', referenceDate: '2110260905', totalTTC: '10.000' }
    const p1 = buildQrPayload(f)
    expect(verifyQrPayload(p1.replace('10.000', '11.000')).valid).toBe(false)
    const prev = process.env.EINVOICE_SIM_HMAC_SECRET
    process.env.EINVOICE_SIM_HMAC_SECRET = 'autre-secret'
    try {
      expect(buildQrPayload(f)).not.toBe(p1)
      expect(verifyQrPayload(p1).valid).toBe(false)
    } finally {
      if (prev === undefined) delete process.env.EINVOICE_SIM_HMAC_SECRET
      else process.env.EINVOICE_SIM_HMAC_SECRET = prev
    }
  })

  test('les cachets sont des ds:Signature enfants directs de TEIF', async () => {
    const r = await simulateTtnSubmission(signed, { now: NOW })
    const doc = parseXml(r.validatedXml!)
    const sigs = findElements(doc, isDs('Signature'))
    expect(sigs.map(s => s.getAttribute('Id'))).toEqual(['SigFrs', 'SigCEv', 'SigTTN'])
    for (const s of sigs) expect(s.parentNode).toBe(doc.documentElement)
  })
})
