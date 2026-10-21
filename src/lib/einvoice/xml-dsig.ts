/**
 * Utilitaires XMLDSig partagés (signature fournisseur XAdES + simulateur TTN).
 * Côté serveur uniquement (node:crypto).
 */
import { createHash, createPrivateKey, privateEncrypt, constants, X509Certificate, verify as cryptoVerify } from 'node:crypto'
import { DOMParser } from '@xmldom/xmldom'
import { ExclusiveCanonicalization } from 'xml-crypto'

export const NS_DS = 'http://www.w3.org/2000/09/xmldsig#'
export const NS_XADES = 'http://uri.etsi.org/01903/v1.3.2#'
export const ALG_EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#'
export const ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
export const ALG_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256'
export const ALG_XPATH = 'http://www.w3.org/TR/1999/REC-xpath-19991116'
export const TYPE_SIGNED_PROPERTIES = 'http://uri.etsi.org/01903#SignedProperties'

// ─── Parsing ──────────────────────────────────────────────────────────────────

export class XmlParseError extends Error {
  constructor(public details: string[]) {
    super('XML mal formé : ' + details.join(' ; '))
  }
}

/** Parse strict : toute erreur ou erreur fatale du parseur lève XmlParseError. */
export function parseXml(xml: string): Document {
  const errors: string[] = []
  const parser = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (m: string) => { errors.push(String(m)) },
      fatalError: (m: string) => { errors.push(String(m)) },
    },
  })
  let doc: Document | undefined
  try {
    doc = parser.parseFromString(xml, 'application/xml') as unknown as Document
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }
  if (errors.length || !doc || !doc.documentElement) throw new XmlParseError(errors.length ? errors : ['document vide'])
  return doc
}

// ─── Canonicalisation & condensés ─────────────────────────────────────────────

/** Canonicalisation XML exclusive (exc-c14n, sans commentaires) d'un élément ou document. */
export function excC14n(node: Element | Document): string {
  return new ExclusiveCanonicalization().process(node as never, {}) as string
}

export function sha256(data: string | Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

export function b64(buf: Buffer): string {
  return buf.toString('base64')
}

function walk(node: Node, visit: (el: Element) => boolean | void) {
  const kids = Array.from(node.childNodes || [])
  for (const k of kids) {
    if (k.nodeType === 1) {
      if (visit(k as Element) === false) continue
      walk(k, visit)
    }
  }
}

/** Tous les éléments (ordre document) correspondant au prédicat. */
export function findElements(root: Node, pred: (el: Element) => boolean): Element[] {
  const out: Element[] = []
  walk(root, el => { if (pred(el)) out.push(el) })
  return out
}

export const isDs = (local: string) => (el: Element) => el.namespaceURI === NS_DS && el.localName === local
export const isXades = (local: string) => (el: Element) => el.namespaceURI === NS_XADES && el.localName === local

export function childElements(el: Element, pred?: (e: Element) => boolean): Element[] {
  return Array.from(el.childNodes || []).filter(n => n.nodeType === 1 && (!pred || pred(n as Element))) as Element[]
}

export function textOf(el: Element | undefined | null): string {
  return (el?.textContent || '').trim()
}

/**
 * Applique les filtres XPath « not(ancestor-or-self::X) » de la référence URI="" :
 * renvoie une copie du document sans les sous-arbres exclus.
 */
export function documentWithout(doc: Document, exclude: { signatures?: boolean; refTtnVal?: boolean }): Document {
  const copy = doc.cloneNode(true) as Document
  const toRemove = findElements(copy, el =>
    (!!exclude.signatures && el.namespaceURI === NS_DS && el.localName === 'Signature') ||
    (!!exclude.refTtnVal && el.localName === 'RefTtnVal' && !el.namespaceURI),
  )
  for (const el of toRemove) el.parentNode?.removeChild(el)
  return copy
}

/** Élément portant l'attribut Id donné (références « #id »). */
export function findById(doc: Document, id: string): Element | undefined {
  return findElements(doc, el => el.getAttribute('Id') === id)[0]
}

// ─── RSA ──────────────────────────────────────────────────────────────────────

/** DigestInfo DER (préfixe) pour SHA-256 — PKCS#1 v1.5. */
const SHA256_DIGEST_INFO_PREFIX = Buffer.from('3031300d060960864801650304020105000420', 'hex')

/** Signature RSA PKCS#1 v1.5 d'un condensé SHA-256 déjà calculé (« signHash »). */
export function rsaSignSha256Digest(digest: Buffer, privateKeyPem: string): Buffer {
  if (digest.length !== 32) throw new Error('Condensé SHA-256 attendu (32 octets)')
  const key = createPrivateKey(privateKeyPem)
  return privateEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.concat([SHA256_DIGEST_INFO_PREFIX, digest]))
}

export function rsaVerifySha256(data: string | Buffer, signature: Buffer, cert: X509Certificate): boolean {
  try {
    return cryptoVerify('sha256', Buffer.from(data), cert.publicKey, signature)
  } catch {
    return false
  }
}

// ─── Certificats ──────────────────────────────────────────────────────────────

export function pemToDer(pem: string): Buffer {
  return Buffer.from(pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64')
}

export function derToPem(der: Buffer): string {
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? ''
  return `-----BEGIN CERTIFICATE-----\n${body}\n-----END CERTIFICATE-----\n`
}

/** Lecture DER minimale : renvoie [tag, début contenu, fin contenu, fin TLV]. */
function readTlv(buf: Buffer, pos: number): { tag: number; start: number; end: number; next: number } {
  const tag = buf[pos]
  let len = buf[pos + 1]
  let p = pos + 2
  if (len & 0x80) {
    const n = len & 0x7f
    len = 0
    for (let i = 0; i < n; i++) len = (len << 8) | buf[p + i]
    p += n
  }
  return { tag, start: p, end: p + len, next: p + len }
}

function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n])
  const bytes: number[] = []
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8 }
  return Buffer.from([0x80 | bytes.length, ...bytes])
}

function tlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content])
}

/** Extrait (DER) le Name de l'émetteur et l'INTEGER du numéro de série d'un certificat. */
export function certIssuerAndSerialDer(certDer: Buffer): { issuer: Buffer; serial: Buffer } {
  const cert = readTlv(certDer, 0)
  const tbs = readTlv(certDer, cert.start)
  let p = tbs.start
  let el = readTlv(certDer, p)
  if (el.tag === 0xa0) { p = el.next; el = readTlv(certDer, p) } // [0] version
  const serial = certDer.subarray(p, el.next) // INTEGER complet
  p = el.next
  p = readTlv(certDer, p).next // AlgorithmIdentifier
  const iss = readTlv(certDer, p)
  return { issuer: certDer.subarray(p, iss.next), serial }
}

/**
 * IssuerSerialV2 (XAdES / RFC 5035) : DER base64 de
 * IssuerSerial ::= SEQUENCE { issuer GeneralNames, serialNumber CertificateSerialNumber }
 * avec GeneralNames = SEQUENCE { [4] directoryName Name }.
 */
export function issuerSerialV2(certDer: Buffer): string {
  const { issuer, serial } = certIssuerAndSerialDer(certDer)
  const generalNames = tlv(0x30, tlv(0xa4, issuer))
  return tlv(0x30, Buffer.concat([generalNames, serial])).toString('base64')
}

/** Vérifie qu'une chaîne (signataire en premier) est cohérente : chaque certificat est émis par le suivant. */
export function verifyChain(chain: X509Certificate[]): string[] {
  const errors: string[] = []
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i]
    const issuer = chain[i + 1] ?? (c.checkIssued(c) ? c : undefined)
    if (!issuer) { errors.push(`Émetteur absent pour « ${c.subject.split('\n').pop()} »`); continue }
    if (!c.checkIssued(issuer) || !c.verify(issuer.publicKey)) errors.push(`Certificat ${i} non émis par le certificat ${i + 1}`)
  }
  return errors
}

export function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
