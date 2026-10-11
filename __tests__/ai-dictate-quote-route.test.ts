/** Route POST /api/ai/dictate-quote : auth, limite, catalogue du tenant, Gemini simulé, repli local, aucune journalisation. */
import { NextRequest, NextResponse } from 'next/server'

const getApiContext = jest.fn()
const rateLimitPersistent = jest.fn()
const productFindMany = jest.fn()
const clientFindMany = jest.fn()
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api')
  return { ...actual, getApiContext: (...a: unknown[]) => getApiContext(...a) }
})
jest.mock('@/lib/rate-limit-persistent', () => ({
  rateLimitPersistent: (...a: unknown[]) => rateLimitPersistent(...a),
  tooManyRequests: () => NextResponse.json({ error: 'rl' }, { status: 429 }),
}))
jest.mock('@/lib/db', () => ({
  prisma: {
    product: { findMany: (...a: unknown[]) => productFindMany(...a) },
    client: { findMany: (...a: unknown[]) => clientFindMany(...a) },
  },
}))

import { POST } from '@/app/api/ai/dictate-quote/route'

const req = (body: unknown) => new NextRequest('http://localhost/api/ai/dictate-quote', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const realFetch = global.fetch
const env = { ...process.env }
const gem = (text: string) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) })

beforeEach(() => {
  getApiContext.mockResolvedValue({ tenantId: 't1' })
  rateLimitPersistent.mockReset().mockResolvedValue({ success: true })
  productFindMany.mockReset().mockResolvedValue([
    { id: 'p1', name: 'Tissu Denim 12oz', code: 'TD-12', salePrice: '10.000', vatRate: '19' },
    { id: 'p2', name: 'Chemise homme blanche', code: 'CH-01', salePrice: 25, vatRate: 19 },
  ])
  clientFindMany.mockReset().mockResolvedValue([{ id: 'c1', name: 'Textiles Sfax' }])
  delete process.env.GEMINI_API_KEY
  delete process.env.GROQ_API_KEY
})
afterEach(() => { global.fetch = realFetch; process.env = { ...env } })

describe('POST /api/ai/dictate-quote', () => {
  it('non authentifié → réponse de getApiContext, aucune lecture', async () => {
    getApiContext.mockResolvedValue(NextResponse.json({ error: 'auth' }, { status: 401 }))
    expect((await POST(req({ transcript: 'x' }))).status).toBe(401)
    expect(productFindMany).not.toHaveBeenCalled()
  })

  it('corps invalide → 400', async () => {
    expect((await POST(req({ transcript: '' }))).status).toBe(400)
    expect((await POST(req('pas du json'))).status).toBe(400)
    expect((await POST(req({ transcript: 'x'.repeat(5001) }))).status).toBe(400)
  })

  it('limite atteinte → 429 (clé par tenant)', async () => {
    rateLimitPersistent.mockResolvedValue({ success: false })
    expect((await POST(req({ transcript: '3 chemises' }))).status).toBe(429)
    expect(rateLimitPersistent).toHaveBeenCalledWith('ai-dictate-quote:tenant:t1', expect.any(Number), 3600)
  })

  it('sans clé IA : analyse locale, catalogue lu avec le tenant de la session', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const res = await POST(req({ transcript: 'client Textiles Sfax, 3 rouleaux de tissu denim à 12,5 dinars, dix chemises' }))
    const body = await res.json()
    expect(body.provider).toBe('local')
    expect(body.result.clientId).toBe('c1')
    expect(body.result.lines).toEqual([
      expect.objectContaining({ productId: 'p1', quantity: 3, unitPrice: 12.5 }),
      expect.objectContaining({ productId: 'p2', quantity: 10, unitPrice: null }),
    ])
    expect(global.fetch).not.toHaveBeenCalled()
    expect(productFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1', isActive: true } }))
    expect(clientFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 't1', isActive: true } }))
  })

  it('Gemini simulé : JSON validé, ids hors catalogue écartés', async () => {
    process.env.GEMINI_API_KEY = 'k'
    global.fetch = jest.fn().mockResolvedValue(gem(JSON.stringify({
      clientId: 'c1', lines: [
        { productId: 'p1', description: 'tissu denim', quantity: 3, unitPrice: '12,500' },
        { productId: 'intrus', description: 'boutons', quantity: 5, unitPrice: null },
      ], validityDays: 15,
    }))) as unknown as typeof fetch
    const res = await POST(req({ transcript: 'trois rouleaux de denim…', locale: 'fr' }))
    const body = await res.json()
    expect(body).toMatchObject({ provider: 'gemini', result: { clientId: 'c1', validityDays: 15 } })
    expect(body.result.lines[0]).toMatchObject({ productId: 'p1', quantity: 3, unitPrice: 12.5 })
    expect(body.result.lines[1]).toMatchObject({ productId: null, description: 'boutons' })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('gemini-3.5-flash-lite')
    expect(String(init.body)).toContain('p1|Tissu Denim 12oz|TD-12|10|19')
  })

  it('Gemini en échec (quota) puis Groq → repli Groq', async () => {
    process.env.GEMINI_API_KEY = 'k'
    process.env.GROQ_API_KEY = 'g'
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '{"lines":[{"productId":"p2","description":"chemise","quantity":2}]}' } }] }) }) as unknown as typeof fetch
    const body = await (await POST(req({ transcript: 'deux chemises' }))).json()
    expect(body.provider).toBe('groq')
    expect(body.aiWarnings).toContain('ai:fallback')
    warn.mockRestore()
  })

  it('IA indisponible → analyse locale, dictée jamais journalisée', async () => {
    process.env.GEMINI_API_KEY = 'k'
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch
    const res = await POST(req({ transcript: '3 chemises SECRET-DICTEE-CLIENT' }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ provider: 'local', aiWarnings: ['ai:unavailable'] })
    expect(body.result.lines[0]).toMatchObject({ quantity: 3 })
    expect(JSON.stringify([warn.mock.calls, error.mock.calls, log.mock.calls])).not.toContain('SECRET-DICTEE')
    warn.mockRestore(); error.mockRestore(); log.mockRestore()
  })

  it('réponse IA sans ligne → analyse locale', async () => {
    process.env.GEMINI_API_KEY = 'k'
    global.fetch = jest.fn().mockResolvedValue(gem('{"lines":[]}')) as unknown as typeof fetch
    const body = await (await POST(req({ transcript: 'dix chemises' }))).json()
    expect(body.provider).toBe('local')
    expect(body.result.lines[0]).toMatchObject({ productId: 'p2', quantity: 10 })
  })
})
