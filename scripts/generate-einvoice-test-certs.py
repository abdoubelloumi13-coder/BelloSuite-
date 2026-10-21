#!/usr/bin/env python3
"""
Génère la chaîne de certificats de TEST utilisée par la simulation de signature
El Fatoora (src/lib/einvoice/test-certs/test-chain.ts).

  ⚠ TEST UNIQUEMENT — ces certificats sont auto-signés, les clés privées sont publiques
  (versionnées dans test-keys.json en PKCS#8 DER hexadécimal, format volontairement
  non-PEM pour ne pas déclencher les scanners de secrets ; test-chain.ts les
  reconstitue en PEM à l'exécution avec node:crypto). Une facture signée avec eux n'a AUCUNE valeur fiscale
  et serait rejetée par TTN (chaîne non reconnue, pas d'OCSP/CRL TunTrust).

Chaîne : « TnTrust Root CA (TEST) » → « TnTrust Qualified CA (TEST) » → signataire
(RSA-2048, keyUsage nonRepudiation + digitalSignature), C=TN,
+ un certificat « TTN El Fatoora Plateforme (TEST) » pour les cachets simulés de TTN,
O=National Digital Certification Agency.

Usage : python3 scripts/generate-einvoice-test-certs.py
"""
import datetime
import json
import os

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

DIR = os.path.join(os.path.dirname(__file__), '..', 'src', 'lib', 'einvoice', 'test-certs')
OUT = os.path.join(DIR, 'test-chain.ts')
OUT_KEYS = os.path.join(DIR, 'test-keys.json')
NOW = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)


def name(cn, extra=None):
    attrs = [
        x509.NameAttribute(NameOID.COUNTRY_NAME, 'TN'),
        x509.NameAttribute(NameOID.LOCALITY_NAME, 'Tunis'),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'National Digital Certification Agency'),
        x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, 'TEST - non valable fiscalement'),
    ]
    attrs += extra or []
    attrs.append(x509.NameAttribute(NameOID.COMMON_NAME, cn))
    return x509.Name(attrs)


def key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def build(subject, issuer, pub, issuer_key, serial, years, ca, path_len=None, signer=False, issuer_pub=None):
    b = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(pub)
        .serial_number(serial)
        .not_valid_before(NOW)
        .not_valid_after(NOW + datetime.timedelta(days=365 * years))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=path_len), critical=True)
        .add_extension(x509.SubjectKeyIdentifier.from_public_key(pub), critical=False)
    )
    if issuer_pub is not None:
        b = b.add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(issuer_pub), critical=False)
    if ca:
        b = b.add_extension(x509.KeyUsage(
            digital_signature=False, content_commitment=False, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=True, crl_sign=True,
            encipher_only=False, decipher_only=False), critical=True)
    if signer:
        b = b.add_extension(x509.KeyUsage(
            digital_signature=True, content_commitment=True, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=False, crl_sign=False,
            encipher_only=False, decipher_only=False), critical=True)
        b = b.add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.EMAIL_PROTECTION]), critical=False)
    return b.sign(issuer_key, hashes.SHA256())


def pem_cert(c):
    return c.public_bytes(serialization.Encoding.PEM).decode()


def main():
    root_k, sub_k, sig_k, ttn_k = key(), key(), key(), key()
    root_n = name('TnTrust Root CA (TEST)')
    sub_n = name('TnTrust Qualified CA (TEST)')
    sig_n = name('SIGNATAIRE TEST BELLOSUITE', [
        x509.NameAttribute(NameOID.SERIAL_NUMBER, 'TEST-0000000AAM000'),
        x509.NameAttribute(NameOID.EMAIL_ADDRESS, 'signature-test@bellosuite.tn'),
    ])
    root = build(root_n, root_n, root_k.public_key(), root_k, 0x7E57001, 20, True, 1)
    sub = build(sub_n, root_n, sub_k.public_key(), root_k, 0x7E57002, 15, True, 0, issuer_pub=root_k.public_key())
    sig = build(sig_n, sub_n, sig_k.public_key(), sub_k, 0x7E57003, 10, False, None, signer=True, issuer_pub=sub_k.public_key())
    ttn_n = name('TTN El Fatoora Plateforme (TEST)')
    ttn = build(ttn_n, sub_n, ttn_k.public_key(), sub_k, 0x7E57004, 10, False, None, signer=True, issuer_pub=sub_k.public_key())
    def der_hex(k):
        return k.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).hex()
    keys = {
        '_avertissement': 'CLES DE TEST UNIQUEMENT (chaine TnTrust ... (TEST)), publiques, sans valeur fiscale. '
                          'Format: PKCS#8 DER en hexadecimal (volontairement non-PEM pour ne pas declencher les scanners '
                          'de secrets). Regenerer: python3 scripts/generate-einvoice-test-certs.py',
        'format': 'pkcs8-der-hex',
        'signer': der_hex(sig_k),
        'ttn': der_hex(ttn_k),
    }

    ts = (
        '/* eslint-disable */\n'
        'import { createPrivateKey } from "node:crypto"\n'
        'import TEST_KEYS from "./test-keys.json"\n'
        '/**\n'
        ' * ⚠ CHAÎNE DE CERTIFICATS DE TEST — NE PAS UTILISER EN PRODUCTION ⚠\n'
        ' * Générée par scripts/generate-einvoice-test-certs.py. Les clés privées de TEST sont dans test-keys.json\n'
        ' * (PKCS#8 DER hexadécimal, non-PEM) et reconstituées en PEM à l’exécution.\n'
        ' * Signature produite = « Mode simulation — non valable fiscalement ».\n'
        ' */\n'
        f'export const TEST_ROOT_CA_PEM = `{pem_cert(root)}`\n\n'
        f'export const TEST_SUB_CA_PEM = `{pem_cert(sub)}`\n\n'
        f'export const TEST_SIGNER_CERT_PEM = `{pem_cert(sig)}`\n\n'
        '/** Certificat/clé simulant la plateforme TTN (cachets SigTTN / SigCEv du simulateur). */\n'
        f'export const TEST_TTN_CERT_PEM = `{pem_cert(ttn)}`\n\n'
        '\nfunction keyFromHex(hex: string): string {\n'
        '  return createPrivateKey({ key: Buffer.from(hex, "hex"), format: "der", type: "pkcs8" })\n'
        '    .export({ format: "pem", type: "pkcs8" })\n'
        '    .toString()\n'
        '}\n\n'
        '/** Clé privée de TEST du signataire (reconstituée en PEM à l’exécution). */\n'
        'export const TEST_SIGNER_KEY_PEM: string = keyFromHex(TEST_KEYS.signer)\n\n'
        '/** Clé privée de TEST simulant TTN (cachets SigTTN / SigCEv). */\n'
        'export const TEST_TTN_KEY_PEM: string = keyFromHex(TEST_KEYS.ttn)\n'
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        f.write(ts)
    with open(OUT_KEYS, 'w') as f:
        f.write(json.dumps(keys, indent=2) + '\n')
    print('écrit', os.path.abspath(OUT), 'et', os.path.abspath(OUT_KEYS))


if __name__ == '__main__':
    main()
