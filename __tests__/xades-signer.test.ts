import { X509Certificate, verify } from 'node:crypto'
import { generateTEIFXml, type TEIFData } from '@/lib/teif-generator'
import {
  signTeifXml, verifyTeifSignature, LocalTestSigner, DigiGoMockSigner, DigiGoMockServer,
  DigiGoMockError, TTN_SIGNATURE_POLICY, testCertificateDetails,
} from '@/lib/einvoice/xades-signer'
import { parseXml, XmlParseError, findElements, isDs, NS_XADES, excC14n } from '@/lib/einvoice/xml-dsig'
import { TEST_SIGNER_CERT_PEM } from '@/lib/einvoice/test-certs/test-chain'

const base: TEIFData = {
  invoiceNumber: 'FAC-2026-0042',
  type: 'INVOICE',
  issueDate: '2026-10-20',
  tenant: { name: 'BelloSuite SARL & Co', matriculeFiscal: '1234567AAM000', address: 'Rue de Marseille', city: 'Tunis', zipCode: '1000' },
  client: { name: 'Client Test', matriculeFiscal: '7654321KNC000', address: 'Av. Habib Bourguiba', city: 'Sfax' },
  items: [
    { description: 'Prestation conseil', quantity: 2, unitPriceHT: 500, totalHT: 1000, vatRate: 19, vatAmount: 190 },
    { description: 'Pièces <spéciales> été', quantity: 1, unitPriceHT: 100, totalHT: 100, vatRate: 7, fodecApply: true, fodecAmount: 1, vatAmount: 7.07 },
  ],
  totals: { subtotalHT: 1100, totalFodec: 1, totalVAT: 197.07, timbreFiscal: 1, totalTTC: 1299.07, vatSummary: {} },
}

const teif = generateTEIFXml(base)
const fixedTime = new Date('2026-10-20T10:15:00Z')

describe('Signature XAdES-B TEIF (simulation)', () => {
  let signed: string

  beforeAll(async () => {
    signed = (await signTeifXml(teif, new LocalTestSigner(), { claimedRole: 'Gérant', signingTime: fixedTime })).xml
  })

  test('la signature produite se vérifie', () => {
    const r = verifyTeifSignature(signed)
    expect(r.errors).toEqual([])
    expect(r.valid).toBe(true)
    expect(r.checks).toEqual({ structure: true, documentDigest: true, signedPropertiesDigest: true, signatureValue: true, certificateDigest: true, chain: true })
    expect(r.claimedRole).toBe('Gérant')
    expect(r.signingTime).toBe('2026-10-20T10:15:00Z')
    expect(r.signer?.isTest).toBe(true)
  })

  test('le contenu TEIF est conservé à l’identique et la signature est le dernier enfant', () => {
    expect(signed.startsWith(teif.slice(0, teif.lastIndexOf('</TEIF>')))).toBe(true)
    const doc = parseXml(signed)
    const root = doc.documentElement
    const last = Array.from(root.childNodes).filter(n => n.nodeType === 1).pop() as Element
    expect(last.localName).toBe('Signature')
    expect(last.getAttribute('Id')).toBe('SigFrs')
  })

  test('identifiants, algorithmes et politique conformes à la spécification TTN V3.0', () => {
    expect(signed).toContain('<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="SigFrs">')
    expect(signed).toContain('<ds:CanonicalizationMethod Algorithm="http://www.w3.org/2001/10/xml-exc-c14n#"/>')
    expect(signed).toContain('<ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/>')
    expect(signed).toContain('<ds:Reference Id="r-id-frs" URI="">')
    expect(signed).toContain('<ds:XPath>not(ancestor-or-self::ds:Signature)</ds:XPath>')
    expect(signed).toContain('<ds:XPath>not(ancestor-or-self::RefTtnVal)</ds:XPath>')
    expect(signed).toContain('<ds:Reference Type="http://uri.etsi.org/01903#SignedProperties" URI="#xades-SigFrs">')
    expect(signed).toContain('<ds:SignatureValue Id="value-SigFrs">')
    expect(signed).toContain('<xades:QualifyingProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Target="#SigFrs">')
    expect(signed).toContain('<xades:SignedProperties Id="xades-SigFrs">')
    expect(signed).toContain('<xades:Identifier Qualifier="OIDasURN">urn:2.16.788.1.2.1</xades:Identifier>')
    expect(signed).toContain('<xades:Description>Politique de signature de la facture electronique</xades:Description>')
    expect(signed).toContain(`<ds:DigestValue>${TTN_SIGNATURE_POLICY.hashSha256}</ds:DigestValue>`)
    expect(signed).toContain('telechargerTelechargement?lien=Politique_de_Signature_de_la_facture_electronique.pdf')
    expect(signed).toContain('<xades:DataObjectFormat ObjectReference="#r-id-frs"><xades:MimeType>application/octet-stream</xades:MimeType>')
    const doc = parseXml(signed)
    const xs = (n: string) => findElements(doc, el => el.namespaceURI === NS_XADES && el.localName === n)
    expect(xs('SigningCertificateV2')).toHaveLength(1)
    expect(xs('IssuerSerialV2')).toHaveLength(1)
    expect(xs('SignerRoleV2')).toHaveLength(1)
    // Ordre des transformations de r-id-frs
    const ref = findElements(doc, el => isDs('Reference')(el) && el.getAttribute('Id') === 'r-id-frs')[0]
    const algs = findElements(ref, isDs('Transform')).map(t => t.getAttribute('Algorithm'))
    expect(algs).toEqual([
      'http://www.w3.org/TR/1999/REC-xpath-19991116',
      'http://www.w3.org/TR/1999/REC-xpath-19991116',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ])
    // KeyInfo : certificat signataire + chaîne (3 certificats)
    expect(findElements(doc, isDs('X509Certificate'))).toHaveLength(3)
  })

  test('valeur RSA vérifiable indépendamment avec node:crypto', () => {
    const doc = parseXml(signed)
    const si = findElements(doc, isDs('SignedInfo'))[0]
    const sv = findElements(doc, isDs('SignatureValue'))[0].textContent!
    expect(verify('sha256', Buffer.from(excC14n(si)), new X509Certificate(TEST_SIGNER_CERT_PEM).publicKey, Buffer.from(sv, 'base64'))).toBe(true)
  })

  test('altération du contenu → signature invalide', () => {
    const tampered = signed.replace('<Amount currencyIdentifier="TND">1299.070</Amount>', '<Amount currencyIdentifier="TND">1.070</Amount>')
    expect(tampered).not.toBe(signed)
    const r = verifyTeifSignature(tampered)
    expect(r.valid).toBe(false)
    expect(r.checks.documentDigest).toBe(false)
  })

  test('altération des propriétés signées ou de la valeur → invalide', () => {
    const role = verifyTeifSignature(signed.replace('<xades:ClaimedRole>Gérant</xades:ClaimedRole>', '<xades:ClaimedRole>Autre</xades:ClaimedRole>'))
    expect(role.valid).toBe(false)
    expect(role.checks.signedPropertiesDigest).toBe(false)
    const v = signed.match(/<ds:SignatureValue Id="value-SigFrs">([^<]+)</)![1]
    const flipped = (v[0] === 'A' ? 'B' : 'A') + v.slice(1)
    const sigBad = verifyTeifSignature(signed.replace(v, flipped))
    expect(sigBad.valid).toBe(false)
    expect(sigBad.checks.signatureValue).toBe(false)
  })

  test('l’ajout d’un bloc RefTtnVal et de signatures TTN ne casse pas la signature fournisseur', () => {
    const withTtn = signed.replace('</TEIF>', '<RefTtnVal><ReferenceTTN refID="I-88">X</ReferenceTTN></RefTtnVal><ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#" Id="SigTTN"/></TEIF>')
    expect(verifyTeifSignature(withTtn).valid).toBe(true)
  })

  test('refuse un TEIF déjà signé ou mal formé', async () => {
    await expect(signTeifXml(signed, new LocalTestSigner())).rejects.toThrow(/déjà signé/)
    await expect(signTeifXml('<TEIF><a></TEIF>', new LocalTestSigner())).rejects.toThrow()
    expect(verifyTeifSignature(teif).valid).toBe(false)
  })

  test('parseXml strict : balises non appariées, attributs sans guillemets, entités inconnues → XmlParseError', () => {
    for (const bad of ['<TEIF><a></TEIF>', '<a></b>', '<TEIF a=1/>', '<a>&foo;</a>', '<TEIF/><x/>', '', '   ']) {
      expect(() => parseXml(bad)).toThrow(XmlParseError)
    }
    expect(parseXml('<TEIF><a b="1">x</a></TEIF>').documentElement.localName).toBe('TEIF')
    expect(verifyTeifSignature('<TEIF><a></TEIF>').errors[0]).toMatch(/XML mal formé/)
  })

  test('DigiGo simulé : flux chain → authorize (OTP) → token → signHash', async () => {
    const signer = new DigiGoMockSigner({ email: 'gerant@exemple.tn', otp: '123456' })
    const r = await signTeifXml(teif, signer, { signingTime: fixedTime })
    expect(verifyTeifSignature(r.xml).valid).toBe(true)
    expect(r.mode).toBe('digigo-mock')
    expect(r.trace.map(s => s.step)).toEqual(['credentials/info/chain', 'oauth2/authorize', 'oauth2/token', 'signatures/signHash'])
  })

  test('DigiGo simulé : OTP invalide, hash différent, SAD réutilisé → refus', async () => {
    await expect(signTeifXml(teif, new DigiGoMockSigner({ email: 'g@x.tn', otp: '12ab' }))).rejects.toBeInstanceOf(DigiGoMockError)
    const server = new DigiGoMockServer()
    const hash = Buffer.alloc(32, 1).toString('base64')
    const { token } = server.authorize({ clientId: server.clientId, credentialId: 'g@x.tn', hash, numSignatures: 1, pin: '1234', otp: '000000' })
    const jti = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).jti
    const { sad } = server.token(server.clientId, 'simulation', jti)
    expect(() => server.signHash(server.clientId, 'g@x.tn', sad, [Buffer.alloc(32, 2).toString('base64')])).toThrow(/hash/)
    expect(() => server.token(server.clientId, 'simulation', jti)).toThrow()
  })

  test('détails du certificat de test', () => {
    const d = testCertificateDetails()
    expect(d.root.subject).toContain('TnTrust Root CA (TEST)')
    expect(d.subCa.subject).toContain('TnTrust Qualified CA (TEST)')
    expect(d.signer.issuer).toContain('O=National Digital Certification Agency')
    expect(new X509Certificate(TEST_SIGNER_CERT_PEM).keyUsage).toBeDefined()
  })
})
