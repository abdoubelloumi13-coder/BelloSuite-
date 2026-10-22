import {
  translateGenericError, errorFromBody, readApiError, wrapFetchWithErrorTranslation, messageForStatus, normalizeLocale,
} from '@/lib/client-errors'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('client-errors', () => {
  it('traduit les messages génériques anglais en français par défaut', () => {
    expect(translateGenericError('Internal error')).toMatch(/Erreur interne/)
    expect(translateGenericError('Internal Server Error')).toMatch(/Erreur interne/)
    expect(translateGenericError('  unauthorized ')).toMatch(/reconnecter/)
    expect(translateGenericError('Failed to fetch')).toMatch(/Connexion au serveur/)
  })

  it('respecte la langue (en / ar) et retombe sur fr', () => {
    expect(translateGenericError('Internal error', 'en')).toMatch(/Internal server error/)
    expect(translateGenericError('Internal error', 'ar')).toMatch(/خطأ داخلي/)
    expect(normalizeLocale('de-DE')).toBe('fr')
  })

  it('laisse intacts les messages métier', () => {
    expect(translateGenericError('Stock insuffisant pour REF-1')).toBe('Stock insuffisant pour REF-1')
  })

  it('errorFromBody : error, message, puis code HTTP', () => {
    expect(errorFromBody(400, { error: 'Nom obligatoire' })).toBe('Nom obligatoire')
    expect(errorFromBody(500, { message: 'Internal Server Error' })).toMatch(/Erreur interne/)
    expect(errorFromBody(404, null)).toBe(messageForStatus(404))
    expect(errorFromBody(502, {})).toMatch(/Erreur interne/)
  })

  it('readApiError lit un corps non JSON sans lever', async () => {
    const res = new Response('<html>oops</html>', { status: 500 })
    await expect(readApiError(res)).resolves.toMatch(/Erreur interne/)
  })

  it('wrapFetch traduit uniquement les erreurs génériques des appels /api', async () => {
    const base = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('generic')) return json({ error: 'Internal error', code: 'X' }, 500)
      if (url.includes('business')) return json({ error: 'Facture déjà validée' }, 409)
      if (url.includes('ok')) return json({ id: 1 }, 200)
      return json({ error: 'Internal error' }, 500)
    }) as unknown as typeof fetch
    const f = wrapFetchWithErrorTranslation(base, () => 'fr')

    const r1 = await f('/api/generic')
    expect(r1.status).toBe(500)
    await expect(r1.json()).resolves.toEqual({ error: expect.stringMatching(/Erreur interne/), code: 'X' })

    await expect((await f('/api/business')).json()).resolves.toEqual({ error: 'Facture déjà validée' })
    await expect((await f('/api/ok')).json()).resolves.toEqual({ id: 1 })
    // Hors /api : inchangé
    await expect((await f('https://example.com/other')).json()).resolves.toEqual({ error: 'Internal error' })
  })
})
