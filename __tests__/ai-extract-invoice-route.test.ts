/** Route POST /api/ai/extract-invoice : tenant, clé absente, limites, repli silencieux. */
import { NextRequest, NextResponse } from 'next/server'

const getApiContext = jest.fn()
const rateLimitPersistent = jest.fn()
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api')
  return { ...actual, getApiContext: (...a: unknown[]) => getApiContext(...a) }
})
jest.mock('@/lib/rate-limit-persistent', () => ({
  rateLimitPersistent: (...a: unknown[]) => rateLimitPersistent(...a),
  // enforceRateLimits réel, branché sur le mock (limites entreprise + utilisateur, cf. lib/security/ai-limits)
  enforceRateLimits: async (limits: Array<{ key: string; max: number; windowSeconds: number }>) => {
    for (const l of limits) {
      const r = await rateLimitPersistent(l.key, l.max, l.windowSeconds)
      if (!r?.success) return NextResponse.json({ error: 'rl' }, { status: 429 })
    }
    return null
  },
  clientIp: () => '127.0.0.1',
  tooManyRequests: () => NextResponse.json({ error: 'rl' }, { status: 429 }),
}))

import { POST } from '@/app/api/ai/extract-invoice/route'

const req = (body: string) => new NextRequest('http://localhost/api/ai/extract-invoice', { method: 'POST', body, headers: { 'content-type': 'application/json' } })
const realFetch = global.fetch
const env = { ...process.env }

beforeEach(() => {
  getApiContext.mockResolvedValue({ tenantId: 't1' })
  rateLimitPersistent.mockResolvedValue({ success: true })
  delete process.env.GEMINI_API_KEY
  delete process.env.GROQ_API_KEY
})
afterEach(() => { global.fetch = realFetch; process.env = { ...env } })

describe('POST /api/ai/extract-invoice', () => {
  it('non authentifié → réponse de getApiContext', async () => {
    getApiContext.mockResolvedValue(NextResponse.json({ error: 'auth' }, { status: 401 }))
    expect((await POST(req('{}'))).status).toBe(401)
  })

  it('sans clé : available=false, aucun appel réseau', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const res = await POST(req(JSON.stringify({ text: 'Total TTC 10,000' })))
    expect(await res.json()).toEqual({ available: false })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('avec clé Gemini : résultat validé, limite par tenant', async () => {
    process.env.GEMINI_API_KEY = 'k'
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"invoiceNumber":"FA-1","total":"7 344,609"}' }] } }] }) }) as unknown as typeof fetch
    const res = await POST(req(JSON.stringify({ text: 'FACTURE FA-1' })))
    expect(await res.json()).toMatchObject({ available: true, provider: 'gemini', result: { invoiceNumber: 'FA-1', total: 7344.609 } })
    expect(rateLimitPersistent).toHaveBeenCalledWith('ai-extract-invoice:tenant:t1', expect.any(Number), expect.any(Number))
  })

  it('quota / erreur IA → result null (pas d’erreur HTTP), contenu jamais journalisé', async () => {
    process.env.GEMINI_API_KEY = 'k'
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const error = jest.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429 }) as unknown as typeof fetch
    const res = await POST(req(JSON.stringify({ text: 'SECRET-INVOICE-CONTENT' })))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ available: true, provider: null, result: null })
    expect(JSON.stringify([warn.mock.calls, error.mock.calls])).not.toContain('SECRET-INVOICE-CONTENT')
    warn.mockRestore(); error.mockRestore()
  })

  it('réponse Gemini partielle → relance unique, aiWarnings sans contenu, une seule unité de quota', async () => {
    process.env.GEMINI_API_KEY = 'k'
    rateLimitPersistent.mockClear()
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const gem = (text: string) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) })
    global.fetch = jest.fn()
      .mockResolvedValueOnce(gem('{"supplierName":"SECRET ALPHA","total":"sept mille","subtotal":null,"lines":null}'))
      .mockResolvedValueOnce(gem('{"supplierName":"ALPHA","subtotal":"6.110,000","total":"7.344,609 DT"}')) as unknown as typeof fetch
    const res = await POST(req(JSON.stringify({ text: 'FACTURE FA-1\nTotal TTC 7 344,609' })))
    const body = await res.json()
    expect(body).toMatchObject({ available: true, provider: 'gemini', result: { subtotal: 6110, total: 7344.609 } })
    expect(body.aiWarnings).toEqual(expect.arrayContaining(['ai:retried', 'ai:string_numbers']))
    expect(JSON.stringify(body.aiWarnings)).not.toContain('ALPHA')
    expect(global.fetch).toHaveBeenCalledTimes(2)
    // une seule unité de quota entreprise malgré la relance
    expect(rateLimitPersistent.mock.calls.filter(c => String(c[0]).includes(':tenant:'))).toHaveLength(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET')
    warn.mockRestore()
  })

  it('limite de débit atteinte → 429', async () => {
    process.env.GEMINI_API_KEY = 'k'
    rateLimitPersistent.mockResolvedValue({ success: false })
    expect((await POST(req(JSON.stringify({ text: 'x' })))).status).toBe(429)
  })

  it('corps > 5 Mo → 413 ; image non data-URL → 400', async () => {
    process.env.GEMINI_API_KEY = 'k'
    expect((await POST(req(JSON.stringify({ text: 'x'.repeat(5 * 1024 * 1024 + 10) })))).status).toBe(413)
    expect((await POST(req(JSON.stringify({ text: 'x', image: 'https://evil.example/a.png' })))).status).toBe(400)
  })
})
