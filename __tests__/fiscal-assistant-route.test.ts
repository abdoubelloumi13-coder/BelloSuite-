/** Routes POST /api/ai/fiscal-assistant et /api/fiscal/search : tenant, validation, limite, citations, refus. */
import { NextRequest, NextResponse } from 'next/server'

const getApiContext = jest.fn()
const rateLimitPersistent = jest.fn()
const searchFiscalKb = jest.fn()
const embedQuery = jest.fn()
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api')
  return { ...actual, getApiContext: (...a: unknown[]) => getApiContext(...a) }
})
jest.mock('@/lib/db', () => ({ prisma: {} }))
jest.mock('@/lib/rate-limit-persistent', () => ({
  rateLimitPersistent: (...a: unknown[]) => rateLimitPersistent(...a),
  tooManyRequests: () => NextResponse.json({ error: 'rl' }, { status: 429 }),
}))
jest.mock('@/lib/fiscal-kb', () => ({
  ...jest.requireActual('@/lib/fiscal-kb'),
  searchFiscalKb: (...a: unknown[]) => searchFiscalKb(...a),
  embedQuery: (...a: unknown[]) => embedQuery(...a),
}))

import { POST } from '@/app/api/ai/fiscal-assistant/route'
import { POST as SEARCH } from '@/app/api/fiscal/search/route'

const req = (url: string, body: unknown) => new NextRequest(`http://localhost${url}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const ask = (body: unknown) => POST(req('/api/ai/fiscal-assistant', body))
const hit = (i: number, outdated = false) => ({
  id: `id${i}`, content: `Article ${i} : le droit de timbre est fixé à 1 dinar.`, section: null, score: 0.5, matchedBy: ['vector', 'fulltext'],
  citation: { label: `Code DET 2026, art. ${i}`, code: 'DET', article: String(i), version: '2026', lang: 'ar', url: 'https://jibaya.tn/det.pdf', outdated },
})
const realFetch = global.fetch
const env = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  getApiContext.mockResolvedValue({ tenantId: 't1' })
  rateLimitPersistent.mockResolvedValue({ success: true })
  embedQuery.mockResolvedValue([0.1])
  searchFiscalKb.mockResolvedValue({ mode: 'hybrid', hits: [hit(1), hit(2), hit(3)] })
  process.env.GEMINI_API_KEY = 'k'
  delete process.env.GROQ_API_KEY
})
afterEach(() => { global.fetch = realFetch; process.env = { ...env } })

describe('POST /api/ai/fiscal-assistant', () => {
  it('non authentifié → 401', async () => {
    getApiContext.mockResolvedValue(NextResponse.json({ error: 'auth' }, { status: 401 }))
    expect((await ask({ question: 'timbre ?' })).status).toBe(401)
  })

  it('question invalide → 400 sans consommer de quota', async () => {
    expect((await ask({ question: 'a' })).status).toBe(400)
    expect((await ask({ question: 'timbre facture', codes: ['XX'] })).status).toBe(400)
    expect(rateLimitPersistent).not.toHaveBeenCalled()
  })

  it('limite par tenant (20/h) → 429', async () => {
    rateLimitPersistent.mockResolvedValue({ success: false })
    const res = await ask({ question: 'Droit de timbre sur facture ?' })
    expect(res.status).toBe(429)
    expect(rateLimitPersistent).toHaveBeenCalledWith('ai-fiscal-assistant:tenant:t1', 20, 3600)
    expect(searchFiscalKb).not.toHaveBeenCalled()
  })

  it('réponse avec citations (code, article, version, url, outdated, excerpt)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Le droit de timbre est de 1 dinar par facture [2].' }] } }] }) }) as unknown as typeof fetch
    const res = await ask({ question: 'Quel est le droit de timbre sur une facture ?', codes: ['DET'] })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.answer).toContain('[2]')
    expect(body.citations).toEqual([expect.objectContaining({ n: 2, label: 'Code DET 2026, art. 2', article: '2', version: '2026', url: 'https://jibaya.tn/det.pdf', outdated: false, excerpt: expect.stringContaining('timbre') })])
    expect(searchFiscalKb.mock.calls[0][2]).toMatchObject({ codes: ['DET'], outdated: 'exclude', limit: 8 })
  })

  it('aucun extrait → refus « je ne trouve pas de base dans les textes », aucun appel IA', async () => {
    searchFiscalKb.mockResolvedValue({ mode: 'fulltext', hits: [] })
    global.fetch = jest.fn() as unknown as typeof fetch
    const body = await (await ask({ question: 'Quelle est la capitale du Pérou ?' })).json()
    expect(body.status).toBe('no_sources')
    expect(body.answer.toLowerCase()).toContain('je ne trouve pas de base dans les textes')
    expect(body.citations).toEqual([])
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('POST /api/fiscal/search', () => {
  it('résultats classés avec extrait ; filtre version actuelle ; limite par tenant', async () => {
    const res = await SEARCH(req('/api/fiscal/search', { q: 'droit de timbre', codes: ['DET'], currentOnly: true, limit: 5 }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('hybrid')
    expect(body.results[0]).toMatchObject({ id: 'id1', snippet: expect.stringContaining('timbre'), citation: { code: 'DET', article: '1' } })
    expect(searchFiscalKb.mock.calls[0][2]).toEqual({ limit: 5, codes: ['DET'], outdated: 'exclude' })
    expect(rateLimitPersistent).toHaveBeenCalledWith('fiscal-search:tenant:t1', 120, 3600)
  })
  it('requête vide → 400', async () => {
    expect((await SEARCH(req('/api/fiscal/search', { q: ' ' }))).status).toBe(400)
  })
})
