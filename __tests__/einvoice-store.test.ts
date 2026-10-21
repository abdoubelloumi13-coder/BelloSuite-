const queryRaw = jest.fn()
const invoiceUpdate = jest.fn()
jest.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
    invoice: { update: (...a: unknown[]) => invoiceUpdate(...a) },
    tenant: { findUnique: jest.fn(), update: jest.fn() },
  },
}))

import {
  getSimulation, saveSignedXml, saveSubmission, isMissingTableError, EInvoiceTableMissingError,
  EINVOICE_TABLE_MISSING_MESSAGE, normalizeEInvoiceSettings,
} from '@/lib/einvoice/store'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('stockage simulation facture électronique', () => {
  beforeEach(() => { queryRaw.mockReset(); invoiceUpdate.mockReset() })

  test('table absente (P2021 ou P2010/42P01) → erreur métier française explicite', async () => {
    expect(isMissingTableError({ code: 'P2021' })).toBe(true)
    expect(isMissingTableError({ code: 'P2010', meta: { code: '42P01' } })).toBe(true)
    expect(isMissingTableError({ message: 'relation "EInvoiceSimulation" does not exist' })).toBe(true)
    expect(isMissingTableError({ code: 'P2002' })).toBe(false)
    queryRaw.mockRejectedValueOnce(Object.assign(new Error('raw query failed'), { code: 'P2010', meta: { code: '42P01' } }))
    await expect(getSimulation('t1', 'inv1')).rejects.toBeInstanceOf(EInvoiceTableMissingError)
    queryRaw.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'P2021' }))
    await expect(getSimulation('t1', 'inv1')).rejects.toThrow(/Exécutez le script SQL einvoice_simulation/)
    expect(new EInvoiceTableMissingError().statusCode).toBe(503)
    expect(EINVOICE_TABLE_MISSING_MESSAGE).toMatch(/einvoice_simulation/)
  })

  test('signature enregistrée → Invoice.ttnStatus SIGNED, références réinitialisées', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 's1', invoiceId: 'inv1' }])
    await saveSignedXml({ tenantId: 't1', invoiceId: 'inv1', mode: 'local', signedXml: '<TEIF/>', signedAt: new Date() })
    expect(invoiceUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inv1', tenantId: 't1' },
      data: expect.objectContaining({ ttnStatus: 'SIGNED', ttnReference: null }),
    }))
  })

  test('dépôt accepté / rejeté → colonnes ttn* existantes mises à jour', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 's1' }])
    const at = new Date('2026-10-21T08:05:00Z')
    await saveSubmission({ tenantId: 't1', invoiceId: 'inv1', submittedAt: at, accepted: true, referenceTTN: 'TTN-SIM-1', qrDataUrl: 'data:', validatedXml: '<TEIF/>' })
    expect(invoiceUpdate.mock.calls[0][0].data).toMatchObject({ ttnStatus: 'ACCEPTED', ttnReference: 'TTN-SIM-1', ttnQRCode: 'data:', ttnSubmittedAt: at, ttnAcceptedAt: at })
    await saveSubmission({ tenantId: 't1', invoiceId: 'inv1', submittedAt: at, accepted: false, errors: ['a', 'b'] })
    expect(invoiceUpdate.mock.calls[1][0].data).toMatchObject({ ttnStatus: 'REJECTED', ttnErrorMessage: 'a ; b' })
  })

  test('dépôt sans signature préalable → 409', async () => {
    queryRaw.mockResolvedValueOnce([])
    await expect(saveSubmission({ tenantId: 't1', invoiceId: 'inv1', submittedAt: new Date(), accepted: true })).rejects.toThrow(/Signez la facture/)
  })

  test('paramètres : TunTrust réel non disponible → repli sur la clé de test', () => {
    expect(normalizeEInvoiceSettings({ mode: 'tuntrust' }).mode).toBe('local')
    expect(normalizeEInvoiceSettings({ mode: 'digigo-mock', signerName: ' Karim ', signerRole: '' })).toMatchObject({ mode: 'digigo-mock', signerName: 'Karim', signerRole: 'Gérant' })
    expect(normalizeEInvoiceSettings(null).mode).toBe('local')
  })

  test('migration SQL additive : table, FK, index, RLS ; aucune colonne ajoutée à Invoice', () => {
    const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261021100000_einvoice_simulation.sql'), 'utf8')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "EInvoiceSimulation"/)
    expect(sql).toMatch(/REFERENCES "Invoice"\("id"\) ON DELETE CASCADE/)
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "EInvoiceSimulation_invoiceId_key"/)
    expect(sql).toMatch(/ALTER TABLE "EInvoiceSimulation" ENABLE ROW LEVEL SECURITY;/)
    expect(sql).not.toMatch(/ALTER TABLE "Invoice"/)
  })
})
