/** Routes facture électronique (simulation) : sign → submit → xml, tenant-scopées, table absente. */
import { NextRequest } from 'next/server'

const getApiContext = jest.fn()
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api')
  return { ...actual, getApiContext: (...a: unknown[]) => getApiContext(...a) }
})

type Row = Record<string, unknown>
let table: Row[] | null = []
const invoiceUpdate = jest.fn()
const invoice = {
  id: 'inv1', tenantId: 't1', number: 'FAC-2026-0042', type: 'INVOICE', date: new Date('2026-10-20T10:00:00Z'), dueDate: null,
  subtotalHT: 1000, totalFodec: 0, totalVAT: 190, timbreFiscal: 1, totalTTC: 1191, vatSummary: {},
  ttnStatus: 'DRAFT', ttnReference: null, ttnQRCode: null, ttnSubmittedAt: null, ttnAcceptedAt: null, ttnErrorMessage: null,
  tenant: { name: 'BelloSuite SARL', matriculeFiscal: '1234567AAM000', address: 'Rue de Marseille', city: 'Tunis', zipCode: '1000' },
  client: { name: 'Client Test', matriculeFiscal: '7654321KNC000', address: 'Av. Bourguiba', city: 'Sfax' },
  items: [{ description: 'Conseil', quantity: 2, unitPrice: 500, totalHT: 1000, vatRate: 19, vatAmount: 190 }],
}
function fakeQueryRaw(strings: TemplateStringsArray, ...v: unknown[]) {
  if (table === null) return Promise.reject(Object.assign(new Error('Raw query failed'), { code: 'P2010', meta: { code: '42P01', message: 'relation "EInvoiceSimulation" does not exist' } }))
  const sql = strings.join('?')
  if (sql.includes('SELECT')) return Promise.resolve(table.filter(r => r.tenantId === v[0] && r.invoiceId === v[1]))
  if (sql.includes('INSERT')) {
    const [id, invoiceId, tenantId, mode, signedXml, signedAt] = v
    table = table.filter(r => r.invoiceId !== invoiceId)
    const row = { id, invoiceId, tenantId, mode, signedXml, signedAt, validatedXml: null, referenceTTN: null, qrDataUrl: null }
    table.push(row)
    return Promise.resolve([row])
  }
  if (sql.includes('UPDATE')) {
    const [validatedXml, referenceTTN, qrDataUrl, tenantId, invoiceId] = v
    const row = table.find(r => r.tenantId === tenantId && r.invoiceId === invoiceId)
    if (row) Object.assign(row, { validatedXml, referenceTTN, qrDataUrl })
    return Promise.resolve(row ? [row] : [])
  }
  return Promise.resolve([])
}
jest.mock('@/lib/db', () => ({
  prisma: {
    $queryRaw: (s: TemplateStringsArray, ...v: unknown[]) => fakeQueryRaw(s, ...v),
    invoice: {
      findFirst: ({ where }: { where: { id: string; tenantId: string } }) =>
        Promise.resolve(where.id === invoice.id && where.tenantId === invoice.tenantId ? invoice : null),
      update: (...a: unknown[]) => invoiceUpdate(...a),
    },
    tenant: { findUnique: () => Promise.resolve({ settings: { einvoice: { mode: 'local', signerRole: 'Gérant', signerName: 'Karim' } } }), update: jest.fn() },
  },
}))

import { POST as SIGN } from '@/app/api/commercial/invoices/[id]/einvoice/sign/route'
import { POST as SUBMIT } from '@/app/api/commercial/invoices/[id]/einvoice/submit/route'
import { GET as XML } from '@/app/api/commercial/invoices/[id]/einvoice/xml/route'
import { GET as STATUS } from '@/app/api/commercial/invoices/[id]/einvoice/route'
import { verifyTeifSignature } from '@/lib/einvoice/xades-signer'
import { verifyValidatedTeif } from '@/lib/einvoice/ttn-simulator'

const url = (p: string) => `http://localhost/api/commercial/invoices/inv1/einvoice${p}`
const post = (p: string, body: unknown = {}) => new NextRequest(url(p), { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const params = (id = 'inv1') => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  table = []
  invoiceUpdate.mockReset().mockResolvedValue({})
  getApiContext.mockResolvedValue({ tenantId: 't1', userRole: 'ADMIN', user: {} })
})

test('flux complet : signature locale → dépôt simulé → téléchargements', async () => {
  const s = await SIGN(post('/sign', { mode: 'local' }), params())
  expect(s.status).toBe(200)
  const sj = await s.json()
  expect(sj).toMatchObject({ step: 'signed', mode: 'local', claimedRole: 'Gérant', simulated: true })
  expect(invoiceUpdate.mock.calls[0][0].data.ttnStatus).toBe('SIGNED')

  const signed = await XML(new NextRequest(url('/xml?signed=1')), params())
  expect(signed.headers.get('content-disposition')).toMatch(/FAC-2026-0042_TEIF_signe_SIMULATION\.xml/)
  expect(verifyTeifSignature(await signed.text()).valid).toBe(true)

  const sub = await SUBMIT(post('/submit'), params())
  expect(sub.status).toBe(200)
  const subj = await sub.json()
  expect(subj.referenceTTN).toMatch(/^TTN-SIM-\d{8}-1234567-\d{6}$/)
  expect(subj.qrDataUrl).toMatch(/^data:image\/png;base64,/)
  expect(invoiceUpdate.mock.calls[1][0].data).toMatchObject({ ttnStatus: 'ACCEPTED', ttnReference: subj.referenceTTN })

  const validated = await XML(new NextRequest(url('/xml?validated=1')), params())
  expect(verifyValidatedTeif(await validated.text()).valid).toBe(true)

  const again = await SUBMIT(post('/submit'), params())
  expect(again.status).toBe(409)

  const st = await (await STATUS(new NextRequest(url('')), params())).json()
  expect(st).toMatchObject({ step: 'validated', referenceTTN: subj.referenceTTN, tableMissing: false })
})

test('TEIF non signé téléchargeable ; dépôt avant signature → 409', async () => {
  const r = await XML(new NextRequest(url('/xml')), params())
  expect(r.status).toBe(200)
  expect(await r.text()).toMatch(/^<\?xml[\s\S]*<TEIF version="1.8.8"/)
  expect((await SUBMIT(post('/submit'), params())).status).toBe(409)
})

test('DigiGo simulé : OTP requis (6 chiffres)', async () => {
  expect((await SIGN(post('/sign', { mode: 'digigo-mock' }), params())).status).toBe(400)
  expect((await SIGN(post('/sign', { mode: 'digigo-mock', otp: '12ab56' }), params())).status).toBe(400)
  const ok = await SIGN(post('/sign', { mode: 'digigo-mock', otp: '123456' }), params())
  expect(ok.status).toBe(200)
  const j = await ok.json()
  expect(j.mode).toBe('digigo-mock')
  expect(j.trace.map((t: { step: string }) => t.step)).toEqual(['credentials/info/chain', 'oauth2/authorize', 'oauth2/token', 'signatures/signHash'])
})

test('facture d’un autre tenant → 404', async () => {
  getApiContext.mockResolvedValue({ tenantId: 't2', userRole: 'ADMIN', user: {} })
  expect((await SIGN(post('/sign', { mode: 'local' }), params())).status).toBe(404)
  expect((await XML(new NextRequest(url('/xml')), params())).status).toBe(404)
})

test('table EInvoiceSimulation absente → 503 avec message « Exécutez le script SQL einvoice_simulation »', async () => {
  table = null
  const r = await SIGN(post('/sign', { mode: 'local' }), params())
  expect(r.status).toBe(503)
  const j = await r.json()
  expect(j.error).toMatch(/Exécutez le script SQL einvoice_simulation/)
  expect(j.code).toBe('EINVOICE_TABLE_MISSING')
  const st = await (await STATUS(new NextRequest(url('')), params())).json()
  expect(st.tableMissing).toBe(true)
})
