/**
 * Signature fournisseur XAdES-B (enveloppée) d'un TEIF 1.8.8 — El Fatoora
 * =========================================================================
 * Suit les « Spécifications Techniques de la Signature Fournisseur V3.0 » (TTN) :
 *   <ds:Signature Id="SigFrs"> dernier enfant de <TEIF>, exc-c14n, RSA-SHA256, SHA-256,
 *   Reference Id="r-id-frs" URI="" (XPath not(ancestor-or-self::ds:Signature),
 *   XPath not(ancestor-or-self::RefTtnVal), exc-c14n), Reference SignedProperties
 *   URI="#xades-SigFrs", SignatureValue Id="value-SigFrs", KeyInfo X509 + chaîne,
 *   QualifyingProperties XAdES 1.3.2 (SigningTime, SigningCertificateV2,
 *   SignaturePolicyIdentifier urn:2.16.788.1.2.1, SignerRoleV2, DataObjectFormat).
 *
 * ⚠ MODE SIMULATION : BelloSuite n'a pas (encore) de certificat TunTrust qualifié.
 * Les signataires fournis ici utilisent une chaîne de TEST auto-signée : la signature
 * est cryptographiquement réelle et vérifiable, mais « non valable fiscalement » ;
 * TTN la rejetterait (chaîne non reconnue). Côté serveur uniquement.
 */
import { X509Certificate, createSign, randomUUID } from 'node:crypto'
import {
  NS_DS, NS_XADES, ALG_EXC_C14N, ALG_RSA_SHA256, ALG_SHA256, ALG_XPATH, TYPE_SIGNED_PROPERTIES,
  parseXml, excC14n, sha256, b64, findElements, findById, childElements, textOf, documentWithout,
  rsaSignSha256Digest, rsaVerifySha256, pemToDer, derToPem, issuerSerialV2, verifyChain, escXml, isDs,
} from './xml-dsig'
import { TEST_ROOT_CA_PEM, TEST_SUB_CA_PEM, TEST_SIGNER_CERT_PEM, TEST_SIGNER_KEY_PEM } from './test-certs/test-chain'

export const SIMULATION_LABEL = 'Mode simulation — non valable fiscalement'

/** Politique de signature de la facture électronique (TTN). */
export const TTN_SIGNATURE_POLICY = {
  identifier: 'urn:2.16.788.1.2.1',
  description: 'Politique de signature de la facture electronique',
  hashSha256: '3J1oMkha+OAlm9hBNCcAS+/nbKokG8Gf9N3XPipP7yg=',
  spuri: 'http://www.tradenet.com.tn/portal/telechargerTelechargement?lien=Politique_de_Signature_de_la_facture_electronique.pdf',
} as const

export const SIG_IDS = {
  signature: 'SigFrs',
  reference: 'r-id-frs',
  signatureValue: 'value-SigFrs',
  signedProperties: 'xades-SigFrs',
} as const

// ─── Signataires ──────────────────────────────────────────────────────────────

export type SignerMode = 'local' | 'digigo-mock'

export interface SignerTraceStep {
  step: string
  detail: string
  at: string
}

/**
 * Un signataire ne voit que le condensé SHA-256 du SignedInfo canonicalisé
 * (comme une signature distante DigiGo « signHash ») et renvoie la signature RSA.
 */
export interface XadesSigner {
  readonly mode: SignerMode
  /** Certificats PEM, signataire en premier puis CA intermédiaire(s) et racine. */
  getCertificateChain(): Promise<string[]>
  /** Signature RSA PKCS#1 v1.5 (RSA_SHA256) du condensé fourni. */
  signDigest(sha256Digest: Buffer): Promise<Buffer>
  /** Journal des étapes (DigiGo simulé). */
  readonly trace: SignerTraceStep[]
}

/** Clé de test locale (chaîne « TnTrust … (TEST) »). */
export class LocalTestSigner implements XadesSigner {
  readonly mode = 'local' as const
  readonly trace: SignerTraceStep[] = []
  constructor(
    private readonly keyPem: string = TEST_SIGNER_KEY_PEM,
    private readonly chainPem: string[] = [TEST_SIGNER_CERT_PEM, TEST_SUB_CA_PEM, TEST_ROOT_CA_PEM],
  ) {}

  async getCertificateChain() {
    return this.chainPem
  }

  async signDigest(digest: Buffer) {
    this.trace.push({ step: 'local.sign', detail: 'Signature RSA-SHA256 avec la clé de test locale', at: new Date().toISOString() })
    return rsaSignSha256Digest(digest, this.keyPem)
  }
}

export class DigiGoMockError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

/**
 * Serveur DigiGo (TunTrust) simulé en mémoire. Reproduit les étapes de l'API
 * « tunsign-proxy-webapp » (§3 doc APIDigigo v01.5) sans aucun appel réseau :
 *   1. GET  /services/v1/credentials/info/{clientId}/{email}/chain
 *   2. GET  /oauth2/authorize?…&hash=… → saisie PIN + OTP → redirect ?token=<JWT> (jti)
 *   3. GET  /services/v1/oauth2/token/{clientId}/authorization_code/{clientSecret}/{jti} → SAD
 *   4. POST /services/v1/signatures/signHash/{clientId}/{email}/{sad}/SHA256/RSA → {algorithm, value}
 */
export class DigiGoMockServer {
  static readonly BASE_URL = 'https://digigo.tuntrust.tn/tunsign-proxy-webapp (SIMULÉ)'
  private authorizations = new Map<string, { email: string; hash: string; exp: number }>()
  private sads = new Map<string, { email: string; hash: string; exp: number }>()

  constructor(
    readonly clientId = '00000000-0000-4000-8000-00000000d1g0',
    private readonly clientSecret = 'simulation',
    private readonly keyPem: string = TEST_SIGNER_KEY_PEM,
    private readonly chainPem: string[] = [TEST_SIGNER_CERT_PEM, TEST_SUB_CA_PEM, TEST_ROOT_CA_PEM],
  ) {}

  credentialsInfoChain(email: string): { certificates: { encodedCertificate: string }[] } {
    if (!email.includes('@')) throw new DigiGoMockError('INVALID_CREDENTIAL', 'credentialId (email) invalide')
    return { certificates: this.chainPem.map(p => ({ encodedCertificate: pemToDer(p).toString('base64') })) }
  }

  /** /oauth2/authorize + écran PIN/OTP. Tout PIN non vide et tout OTP à 6 chiffres sont acceptés. */
  authorize(p: { clientId: string; credentialId: string; hash: string; numSignatures: number; pin: string; otp: string }): { token: string } {
    if (p.clientId !== this.clientId) throw new DigiGoMockError('INVALID_CLIENT', 'clientId inconnu')
    if (p.numSignatures !== 1) throw new DigiGoMockError('INVALID_REQUEST', 'numSignatures doit valoir 1')
    if (!/^[A-Za-z0-9+/]{43}=$/.test(p.hash)) throw new DigiGoMockError('INVALID_HASH', 'hash SHA-256 base64 attendu')
    if (!p.pin) throw new DigiGoMockError('INVALID_PIN', 'PIN requis')
    if (!/^\d{6}$/.test(p.otp)) throw new DigiGoMockError('INVALID_OTP', 'Code OTP à 6 chiffres attendu')
    const jti = randomUUID()
    const exp = Math.floor(Date.now() / 1000) + 300 // JWT 5 min
    this.authorizations.set(jti, { email: p.credentialId, hash: p.hash, exp })
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const head = enc({ alg: 'RS256', typ: 'JWT' })
    const body = enc({ jti, sub: p.credentialId, aud: p.clientId, exp, sim: true })
    const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(this.keyPem).toString('base64url')
    return { token: `${head}.${body}.${sig}` }
  }

  token(clientId: string, clientSecret: string, jti: string): { sad: string; tokenType: 'SAD'; expiresIn: number } {
    if (clientId !== this.clientId || clientSecret !== this.clientSecret) throw new DigiGoMockError('INVALID_CLIENT', 'Identifiants client invalides')
    const auth = this.authorizations.get(jti)
    if (!auth || auth.exp < Date.now() / 1000) throw new DigiGoMockError('INVALID_GRANT', 'Code d’autorisation inconnu ou expiré')
    this.authorizations.delete(jti) // usage unique
    const sad = randomUUID()
    this.sads.set(sad, { email: auth.email, hash: auth.hash, exp: Math.floor(Date.now() / 1000) + 3600 })
    return { sad, tokenType: 'SAD', expiresIn: 3600 }
  }

  signHash(clientId: string, email: string, sad: string, hashes: string[]): { algorithm: 'RSA_SHA256'; value: string } {
    const s = this.sads.get(sad)
    if (clientId !== this.clientId || !s || s.email !== email || s.exp < Date.now() / 1000) throw new DigiGoMockError('INVALID_SAD', 'SAD invalide')
    if (hashes.length !== 1 || hashes[0] !== s.hash) throw new DigiGoMockError('HASH_MISMATCH', 'Le hash ne correspond pas au hash autorisé')
    this.sads.delete(sad)
    return { algorithm: 'RSA_SHA256', value: rsaSignSha256Digest(Buffer.from(hashes[0], 'base64'), this.keyPem).toString('base64') }
  }
}

/** Signataire « DigiGo simulé » : enchaîne les appels DigiGo contre le serveur en mémoire. */
export class DigiGoMockSigner implements XadesSigner {
  readonly mode = 'digigo-mock' as const
  readonly trace: SignerTraceStep[] = []
  private readonly server: DigiGoMockServer
  constructor(private readonly opts: { email: string; otp: string; pin?: string; server?: DigiGoMockServer }) {
    this.server = opts.server ?? new DigiGoMockServer()
  }

  private log(step: string, detail: string) {
    this.trace.push({ step, detail, at: new Date().toISOString() })
  }

  async getCertificateChain() {
    const info = this.server.credentialsInfoChain(this.opts.email)
    this.log('credentials/info/chain', `${info.certificates.length} certificats reçus pour ${this.opts.email}`)
    return info.certificates.map(c => derToPem(Buffer.from(c.encodedCertificate, 'base64')))
  }

  async signDigest(digest: Buffer) {
    const hash = digest.toString('base64')
    const { token } = this.server.authorize({
      clientId: this.server.clientId, credentialId: this.opts.email, hash, numSignatures: 1,
      pin: this.opts.pin ?? 'simulation', otp: this.opts.otp,
    })
    const jti = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).jti as string
    this.log('oauth2/authorize', `PIN + OTP validés (simulation), jeton JWT reçu (jti ${jti.slice(0, 8)}…)`)
    const { sad } = this.server.token(this.server.clientId, 'simulation', jti)
    this.log('oauth2/token', 'SAD obtenu (validité 3600 s)')
    const res = this.server.signHash(this.server.clientId, this.opts.email, sad, [hash])
    this.log('signatures/signHash', `Signature ${res.algorithm} reçue`)
    return Buffer.from(res.value, 'base64')
  }
}

// ─── Construction de la signature ─────────────────────────────────────────────

export interface SignOptions {
  /** Rôle déclaré (SignerRoleV2/ClaimedRole), ex. « CEO », « Gérant ». */
  claimedRole?: string
  signingTime?: Date
}

export interface SignResult {
  xml: string
  mode: SignerMode
  signingTime: string
  signatureValue: string
  signer: CertificateSummary
  trace: SignerTraceStep[]
  simulated: true
}

export interface CertificateSummary {
  subject: string
  issuer: string
  serialNumber: string
  validFrom: string
  validTo: string
  fingerprint256: string
  isTest: boolean
}

export function summarizeCertificate(pem: string): CertificateSummary {
  const c = new X509Certificate(pem)
  const oneLine = (dn: string) => dn.split('\n').filter(Boolean).join(', ')
  return {
    subject: oneLine(c.subject),
    issuer: oneLine(c.issuer),
    serialNumber: c.serialNumber,
    validFrom: new Date(c.validFrom).toISOString(),
    validTo: new Date(c.validTo).toISOString(),
    fingerprint256: c.fingerprint256,
    isTest: /\(TEST\)|TEST/.test(c.issuer + c.subject),
  }
}

const certB64 = (pem: string) => pemToDer(pem).toString('base64')
const xsdDateTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

function signedPropertiesXml(p: { signingTime: string; certDigest: string; issuerSerial: string; role: string }): string {
  const pol = TTN_SIGNATURE_POLICY
  return (
    `<xades:SignedProperties Id="${SIG_IDS.signedProperties}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${p.signingTime}</xades:SigningTime>` +
    `<xades:SigningCertificateV2><xades:Cert><xades:CertDigest>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue>${p.certDigest}</ds:DigestValue>` +
    `</xades:CertDigest><xades:IssuerSerialV2>${p.issuerSerial}</xades:IssuerSerialV2></xades:Cert></xades:SigningCertificateV2>` +
    `<xades:SignaturePolicyIdentifier><xades:SignaturePolicyId><xades:SigPolicyId>` +
    `<xades:Identifier Qualifier="OIDasURN">${pol.identifier}</xades:Identifier>` +
    `<xades:Description>${pol.description}</xades:Description>` +
    `</xades:SigPolicyId><xades:SigPolicyHash><ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue>${pol.hashSha256}</ds:DigestValue></xades:SigPolicyHash>` +
    `<xades:SigPolicyQualifiers><xades:SigPolicyQualifier><xades:SPURI>${escXml(pol.spuri)}</xades:SPURI></xades:SigPolicyQualifier></xades:SigPolicyQualifiers>` +
    `</xades:SignaturePolicyId></xades:SignaturePolicyIdentifier>` +
    `<xades:SignerRoleV2><xades:ClaimedRoles><xades:ClaimedRole>${escXml(p.role)}</xades:ClaimedRole></xades:ClaimedRoles></xades:SignerRoleV2>` +
    `</xades:SignedSignatureProperties>` +
    `<xades:SignedDataObjectProperties><xades:DataObjectFormat ObjectReference="#${SIG_IDS.reference}">` +
    `<xades:MimeType>application/octet-stream</xades:MimeType></xades:DataObjectFormat></xades:SignedDataObjectProperties>` +
    `</xades:SignedProperties>`
  )
}

function signedInfoXml(docDigest: string, spDigest: string): string {
  return (
    `<ds:SignedInfo>` +
    `<ds:CanonicalizationMethod Algorithm="${ALG_EXC_C14N}"/>` +
    `<ds:SignatureMethod Algorithm="${ALG_RSA_SHA256}"/>` +
    `<ds:Reference Id="${SIG_IDS.reference}" URI="">` +
    `<ds:Transforms>` +
    `<ds:Transform Algorithm="${ALG_XPATH}"><ds:XPath>not(ancestor-or-self::ds:Signature)</ds:XPath></ds:Transform>` +
    `<ds:Transform Algorithm="${ALG_XPATH}"><ds:XPath>not(ancestor-or-self::RefTtnVal)</ds:XPath></ds:Transform>` +
    `<ds:Transform Algorithm="${ALG_EXC_C14N}"/>` +
    `</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue>${docDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `<ds:Reference Type="${TYPE_SIGNED_PROPERTIES}" URI="#${SIG_IDS.signedProperties}">` +
    `<ds:Transforms><ds:Transform Algorithm="${ALG_EXC_C14N}"/></ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${ALG_SHA256}"/><ds:DigestValue>${spDigest}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`
  )
}

/** Insère un fragment juste avant la balise fermante de l'élément racine. */
export function insertBeforeRootEnd(xml: string, fragment: string): string {
  const i = xml.lastIndexOf('</')
  if (i < 0) throw new Error('Balise fermante racine introuvable')
  return xml.slice(0, i) + fragment + xml.slice(i)
}

/**
 * Signe un TEIF non signé en XAdES-B enveloppé (bloc ds:Signature Id="SigFrs").
 * Le contenu du TEIF n'est pas modifié : la signature est ajoutée en dernier enfant de <TEIF>.
 */
export async function signTeifXml(teifXml: string, signer: XadesSigner, opts: SignOptions = {}): Promise<SignResult> {
  const doc = parseXml(teifXml)
  if (doc.documentElement.localName !== 'TEIF') throw new Error('Racine <TEIF> attendue')
  if (findElements(doc, isDs('Signature')).length) throw new Error('Le TEIF est déjà signé')

  // Référence 1 : document entier sans ds:Signature ni RefTtnVal, exc-c14n, SHA-256
  const docDigest = b64(sha256(excC14n(documentWithout(doc, { signatures: true, refTtnVal: true }))))

  const chain = await signer.getCertificateChain()
  if (!chain.length) throw new Error('Chaîne de certificats vide')
  const signerDer = pemToDer(chain[0])
  const signingTime = xsdDateTime(opts.signingTime ?? new Date())
  const sp = signedPropertiesXml({
    signingTime,
    certDigest: b64(sha256(signerDer)),
    issuerSerial: issuerSerialV2(signerDer),
    role: (opts.claimedRole || 'CEO').slice(0, 100),
  })

  const keyInfo = `<ds:KeyInfo><ds:X509Data>${chain.map(p => `<ds:X509Certificate>${certB64(p)}</ds:X509Certificate>`).join('')}</ds:X509Data></ds:KeyInfo>`
  const object = `<ds:Object><xades:QualifyingProperties xmlns:xades="${NS_XADES}" Target="#${SIG_IDS.signature}">${sp}</xades:QualifyingProperties></ds:Object>`
  const build = (spDigest: string, sigValue: string) =>
    `<ds:Signature xmlns:ds="${NS_DS}" Id="${SIG_IDS.signature}">` +
    signedInfoXml(docDigest, spDigest) +
    `<ds:SignatureValue Id="${SIG_IDS.signatureValue}">${sigValue}</ds:SignatureValue>` +
    keyInfo + object +
    `</ds:Signature>`

  // Référence 2 : SignedProperties canonicalisées dans leur contexte final
  const draft = parseXml(insertBeforeRootEnd(teifXml, build('', '')))
  const spEl = findById(draft, SIG_IDS.signedProperties)!
  const spDigest = b64(sha256(excC14n(spEl)))

  // SignedInfo canonicalisé → condensé → signataire (local ou DigiGo simulé)
  const withDigests = parseXml(insertBeforeRootEnd(teifXml, build(spDigest, '')))
  const si = findElements(withDigests, isDs('SignedInfo'))[0]
  const siDigest = sha256(excC14n(si))
  const signature = await signer.signDigest(siDigest)
  const sigValue = b64(signature)

  const xml = insertBeforeRootEnd(teifXml, build(spDigest, sigValue))
  return {
    xml,
    mode: signer.mode,
    signingTime,
    signatureValue: sigValue,
    signer: summarizeCertificate(chain[0]),
    trace: signer.trace,
    simulated: true,
  }
}

// ─── Vérification ─────────────────────────────────────────────────────────────

export interface VerifyResult {
  valid: boolean
  errors: string[]
  checks: {
    structure: boolean
    documentDigest: boolean
    signedPropertiesDigest: boolean
    signatureValue: boolean
    certificateDigest: boolean
    chain: boolean
  }
  signer?: CertificateSummary
  signingTime?: string
  claimedRole?: string
}

/**
 * Vérifie la signature fournisseur SigFrs : structure conforme au profil TTN,
 * condensés des deux références, valeur RSA et cohérence de la chaîne fournie.
 * (Pas de contrôle de révocation ni d'ancrage TunTrust : simulation.)
 */
export function verifyTeifSignature(xml: string, signatureId: string = SIG_IDS.signature): VerifyResult {
  const errors: string[] = []
  const checks = { structure: false, documentDigest: false, signedPropertiesDigest: false, signatureValue: false, certificateDigest: false, chain: false }
  const fail = (): VerifyResult => ({ valid: false, errors, checks })

  let doc: Document
  try { doc = parseXml(xml) } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); return fail() }

  const sigs = findElements(doc, el => isDs('Signature')(el) && el.getAttribute('Id') === signatureId)
  if (sigs.length !== 1) { errors.push(`Exactement une signature Id="${signatureId}" attendue (trouvé ${sigs.length})`); return fail() }
  const sig = sigs[0]
  if (sig.parentNode !== doc.documentElement) errors.push('La signature doit être un enfant direct de <TEIF>')

  const si = childElements(sig, isDs('SignedInfo'))[0]
  const sv = childElements(sig, isDs('SignatureValue'))[0]
  if (!si || !sv) { errors.push('SignedInfo ou SignatureValue manquant'); return fail() }

  // Structure
  const structErrors: string[] = []
  const alg = (el: Element | undefined) => el?.getAttribute('Algorithm') || ''
  if (alg(childElements(si, isDs('CanonicalizationMethod'))[0]) !== ALG_EXC_C14N) structErrors.push('CanonicalizationMethod ≠ exc-c14n')
  if (alg(childElements(si, isDs('SignatureMethod'))[0]) !== ALG_RSA_SHA256) structErrors.push('SignatureMethod ≠ rsa-sha256')
  if (sv.getAttribute('Id') !== SIG_IDS.signatureValue) structErrors.push('SignatureValue Id ≠ value-SigFrs')
  const refs = childElements(si, isDs('Reference'))
  const docRef = refs.find(r => r.getAttribute('URI') === '')
  const spRef = refs.find(r => r.getAttribute('Type') === TYPE_SIGNED_PROPERTIES)
  if (refs.length !== 2 || !docRef || !spRef) structErrors.push('Deux références attendues (document URI="" et SignedProperties)')
  if (docRef) {
    if (docRef.getAttribute('Id') !== SIG_IDS.reference) structErrors.push('Reference Id ≠ r-id-frs')
    const tr = findElements(docRef, isDs('Transform'))
    const xp = tr.map(t => textOf(findElements(t, isDs('XPath'))[0]))
    if (tr.length !== 3 || alg(tr[0]) !== ALG_XPATH || xp[0] !== 'not(ancestor-or-self::ds:Signature)' ||
        alg(tr[1]) !== ALG_XPATH || xp[1] !== 'not(ancestor-or-self::RefTtnVal)' || alg(tr[2]) !== ALG_EXC_C14N) {
      structErrors.push('Transformations de r-id-frs non conformes')
    }
  }
  if (spRef && spRef.getAttribute('URI') !== `#${SIG_IDS.signedProperties}`) structErrors.push('Référence SignedProperties ≠ #xades-SigFrs')
  for (const r of refs) if (alg(findElements(r, isDs('DigestMethod'))[0]) !== ALG_SHA256) structErrors.push('DigestMethod ≠ sha256')

  const qp = findElements(sig, el => el.namespaceURI === NS_XADES && el.localName === 'QualifyingProperties')[0]
  const sp = findById(doc, SIG_IDS.signedProperties)
  if (!qp || qp.getAttribute('Target') !== `#${signatureId}`) structErrors.push('QualifyingProperties Target incorrect')
  if (!sp || sp.namespaceURI !== NS_XADES || sp.localName !== 'SignedProperties') structErrors.push('SignedProperties Id="xades-SigFrs" (XAdES 1.3.2) manquant')
  const x = (local: string) => (sp ? findElements(sp, el => el.namespaceURI === NS_XADES && el.localName === local) : [])
  const signingTime = textOf(x('SigningTime')[0])
  if (!signingTime) structErrors.push('SigningTime manquant')
  if (textOf(x('Identifier')[0]) !== TTN_SIGNATURE_POLICY.identifier || x('Identifier')[0]?.getAttribute('Qualifier') !== 'OIDasURN') structErrors.push('Identifiant de politique incorrect')
  const polHash = x('SigPolicyHash')[0]
  if (!polHash || textOf(findElements(polHash, isDs('DigestValue'))[0]) !== TTN_SIGNATURE_POLICY.hashSha256) structErrors.push('SigPolicyHash incorrect')
  if (textOf(x('SPURI')[0]) !== TTN_SIGNATURE_POLICY.spuri) structErrors.push('SPURI incorrect')
  const claimedRole = textOf(x('ClaimedRole')[0])
  if (!claimedRole) structErrors.push('SignerRoleV2/ClaimedRole manquant')
  const dof = x('DataObjectFormat')[0]
  if (!dof || dof.getAttribute('ObjectReference') !== `#${SIG_IDS.reference}` || textOf(x('MimeType')[0]) !== 'application/octet-stream') structErrors.push('DataObjectFormat incorrect')
  errors.push(...structErrors)
  checks.structure = structErrors.length === 0

  // Référence 1 : document
  if (docRef) {
    const expected = textOf(findElements(docRef, isDs('DigestValue'))[0])
    const actual = b64(sha256(excC14n(documentWithout(doc, { signatures: true, refTtnVal: true }))))
    checks.documentDigest = expected === actual
    if (!checks.documentDigest) errors.push('Condensé du document invalide : le TEIF a été modifié après signature')
  }
  // Référence 2 : SignedProperties
  if (spRef && sp) {
    const expected = textOf(findElements(spRef, isDs('DigestValue'))[0])
    checks.signedPropertiesDigest = expected === b64(sha256(excC14n(sp)))
    if (!checks.signedPropertiesDigest) errors.push('Condensé des SignedProperties invalide')
  }

  // Certificats
  const certs = findElements(sig, isDs('X509Certificate')).map(c => {
    try { return new X509Certificate(Buffer.from(textOf(c).replace(/\s+/g, ''), 'base64')) } catch { return null }
  })
  if (!certs.length || certs.some(c => !c)) { errors.push('Certificat X509 manquant ou illisible'); return { valid: false, errors, checks, signingTime, claimedRole } }
  const chain = certs as X509Certificate[]
  const signerCert = chain[0]

  checks.signatureValue = rsaVerifySha256(excC14n(si), Buffer.from(textOf(sv).replace(/\s+/g, ''), 'base64'), signerCert)
  if (!checks.signatureValue) errors.push('Valeur de signature RSA invalide')

  const certDigest = x('CertDigest')[0]
  checks.certificateDigest = !!certDigest && textOf(findElements(certDigest, isDs('DigestValue'))[0]) === b64(sha256(signerCert.raw)) &&
    textOf(x('IssuerSerialV2')[0]) === issuerSerialV2(signerCert.raw)
  if (!checks.certificateDigest) errors.push('SigningCertificateV2 ne correspond pas au certificat signataire')

  const chainErrors = verifyChain(chain)
  checks.chain = chainErrors.length === 0
  errors.push(...chainErrors)

  return {
    valid: errors.length === 0,
    errors,
    checks,
    signer: summarizeCertificate(derToPem(signerCert.raw)),
    signingTime,
    claimedRole,
  }
}

/** Détails de la chaîne de test (page Paramètres). */
export function testCertificateDetails() {
  return {
    signer: summarizeCertificate(TEST_SIGNER_CERT_PEM),
    subCa: summarizeCertificate(TEST_SUB_CA_PEM),
    root: summarizeCertificate(TEST_ROOT_CA_PEM),
    label: SIMULATION_LABEL,
  }
}
