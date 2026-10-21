/** Dépôt TTN « historique » (prestataire ASP) : en mode simulation, réponse immédiate 409 sans toucher la facture. */
import { NextResponse } from 'next/server'

const requireTenant = jest.fn()
jest.mock('@/lib/api-auth', () => ({ requireTenant: (...a: unknown[]) => requireTenant(...a) }))
const findFirst = jest.fn()
const update = jest.fn()
jest.mock('@/lib/db', () => ({ prisma: { invoice: { findFirst: (...a: unknown[]) => findFirst(...a), update: (...a: unknown[]) => update(...a) }, aSPConfiguration: { findUnique: jest.fn() } } }))

import { POST } from '@/app/api/commercial/invoices/[id]/ttn-submit/route'
import { isAspSubmitEnabled } from '@/lib/ttn-asp'

const req = () => new Request('http://localhost/api/commercial/invoices/inv1/ttn-submit', { method: 'POST', body: '{}' })
const params = { params: Promise.resolve({ id: 'inv1' }) }

beforeEach(() => {
  delete process.env.TTN_ASP_VERIFIED
  requireTenant.mockResolvedValue({ tenantId: 't1', userRole: 'ADMIN', user: {} })
  findFirst.mockReset(); update.mockReset()
})

test('simulation (défaut) : 409 SIMULATION_MODE immédiat, facture non modifiée', async () => {
  expect(isAspSubmitEnabled()).toBe(false)
  const res = await POST(req(), params)
  expect(res.status).toBe(409)
  expect((await res.json()).errorCode).toBe('SIMULATION_MODE')
  expect(findFirst).not.toHaveBeenCalled()
  expect(update).not.toHaveBeenCalled()
})

test('sans session : réponse de requireTenant', async () => {
  requireTenant.mockResolvedValueOnce(NextResponse.json({ error: 'Non authentifié' }, { status: 401 }))
  expect((await POST(req(), params)).status).toBe(401)
})
