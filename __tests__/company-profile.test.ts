/** Profil société émetteur (TEIF / impression) + normalisation des matricules fiscaux. */
import { NextRequest } from 'next/server'
import { normalizeMatricule, isValidMatricule, isValidCin, normalizeFiscalId, isValidRib } from '@/lib/matricule'
import { teifMatricule } from '@/lib/teif-generator'

const getApiContext = jest.fn()
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api')
  return { ...actual, getApiContext: (...a: unknown[]) => getApiContext(...a) }
})

let tenant: Record<string, unknown> = {}
const update = jest.fn()
jest.mock('@/lib/db', () => ({
  prisma: {
    tenant: {
      findUnique: ({ where }: { where: { id: string } }) => Promise.resolve(where.id === 't1' ? tenant : null),
      update: (a: { where: { id: string }; data: Record<string, unknown> }) => { update(a); Object.assign(tenant, a.data); return Promise.resolve(tenant) },
    },
  },
}))

import { GET, PUT } from '@/app/api/tenant/company/route'
import { createClientSchema } from '@/services/clients'

const put = (body: unknown) => new NextRequest('http://localhost/api/tenant/company', { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  tenant = { name: 'Ancienne SARL', matriculeFiscal: null, address: null, city: null, zipCode: null, phone: null, email: null, settings: { einvoice: { mode: 'local' } } }
  update.mockReset()
  getApiContext.mockResolvedValue({ tenantId: 't1', userRole: 'ADMIN', user: {} })
})

describe('matricule fiscal', () => {
  it('normalise les séparateurs et la casse', () => {
    expect(normalizeMatricule(' 1234567/a/a/m/000 ')).toBe('1234567AAM000')
    expect(isValidMatricule('1234567/A/A/M/000')).toBe(true)
    expect(isValidMatricule('1234567/A/M/000')).toBe(false)
    expect(teifMatricule('1234567/a/a/m/000')).toBe('1234567AAM000')
  })
  it('CIN 8 chiffres et RIB 20 chiffres', () => {
    expect(isValidCin('01234567')).toBe(true)
    expect(isValidCin('1234567')).toBe(false)
    expect(normalizeFiscalId('01234567')).toBe('01234567')
    expect(normalizeFiscalId('7654321/k/n/c/000')).toBe('7654321KNC000')
    expect(isValidRib('08 006 0123456789012')).toBe(false)
    expect(isValidRib('08 006 012345678901 234')).toBe(true)
  })
  it('fiche client : matricule normalisé à l’enregistrement', () => {
    const r = createClientSchema.safeParse({ tenantId: 't1', name: 'X', matriculeFiscal: '7654321/k/n/c/000' })
    expect(r.success && r.data.matriculeFiscal).toBe('7654321KNC000')
  })
})

describe('/api/tenant/company', () => {
  it('PUT enregistre les colonnes Tenant (matricule normalisé) et le RIB dans settings.company sans écraser les autres réglages', async () => {
    const res = await PUT(put({
      name: 'BelloSuite SARL', matriculeFiscal: '1234567/a/a/m/000', address: 'Rue de Marseille', city: 'Tunis',
      zipCode: '1000', phone: '+216 71 000 000', email: 'contact@bello.tn', rib: '08006012345678901234',
    }))
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d).toMatchObject({ name: 'BelloSuite SARL', matriculeFiscal: '1234567AAM000', rib: '08006012345678901234', city: 'Tunis' })
    const data = update.mock.calls[0][0].data
    expect(data.matriculeFiscal).toBe('1234567AAM000')
    expect(data.settings).toEqual({ einvoice: { mode: 'local' }, company: { rib: '08006012345678901234' } })
    expect(update.mock.calls[0][0].where).toEqual({ id: 't1' })

    const g = await (await GET(new NextRequest('http://localhost/api/tenant/company'))).json()
    expect(g.matriculeFiscal).toBe('1234567AAM000')
  })

  it('PUT refuse un matricule incomplet (400) et ne modifie rien', async () => {
    const res = await PUT(put({ name: 'X', matriculeFiscal: '1234567/A/M/000' }))
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })

  it('PUT sans session → réponse de getApiContext', async () => {
    const { NextResponse } = await import('next/server')
    getApiContext.mockResolvedValueOnce(NextResponse.json({ error: 'Non authentifié' }, { status: 401 }))
    expect((await PUT(put({ name: 'X' }))).status).toBe(401)
  })
})
