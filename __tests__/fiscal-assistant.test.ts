/** Assistant fiscal : langue, prompts, citations, orchestration (récupération et LLM simulés). */
import {
  askFiscalAssistant, buildSystemPrompt, buildUserPrompt, citedNumbers, detectLang, stripUnknownRefs, toCitations, REFUSAL, DISCLAIMER,
} from '@/lib/fiscal-assistant'
import type { FiscalHit } from '@/lib/fiscal-kb'

const hit = (i: number, over: Partial<FiscalHit['citation']> = {}, content = `Contenu ${i} : taux de 19 %.`): FiscalHit => ({
  id: `id${i}`, content, section: null, score: 1 / i, matchedBy: ['fulltext'],
  citation: { label: `Code de la TVA 2026, art. ${i}`, code: 'TVA', article: String(i), version: '2026', lang: 'fr', url: `https://jibaya.tn/${i}.pdf`, outdated: false, ...over },
})

const gemini = (text: string) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) })
const db = { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() }
const gem = { name: 'gemini' as const, key: 'k', model: 'm' }
const groq = { name: 'groq' as const, key: 'g', model: 'q' }

describe('detectLang', () => {
  it('arabe, français, anglais', () => {
    expect(detectLang('ما هي نسبة الأداء على القيمة المضافة؟')).toBe('ar')
    expect(detectLang('Quel est le taux de TVA sur les tissus ?')).toBe('fr')
    expect(detectLang('What is the VAT rate for textile products?')).toBe('en')
    expect(detectLang('FODEC')).toBe('fr')
  })
})

describe('prompts', () => {
  it('système : extraits seuls, citations [n], refus exact, langue, pas d’invention', () => {
    const p = buildSystemPrompt('ar')
    expect(p).toContain(REFUSAL.ar)
    expect(p).toMatch(/N'invente jamais un taux/)
    expect(p).toContain('[n]')
    expect(p).toContain('arabe')
  })
  it('utilisateur : extraits numérotés avec code/article/version, périmés signalés, tronqués', () => {
    const u = buildUserPrompt('Q ?', [hit(1), hit(2, { outdated: true, version: '2017' }, 'x'.repeat(5000))], 2000)
    expect(u).toContain('[1] Code de la TVA 2026, art. 1 | code=TVA | article=1 | version=2026')
    expect(u).toMatch(/\[2\][^\n]*version=2017 \| PÉRIMÉ/)
    expect(u).toContain('…')
    expect(u.endsWith('QUESTION :\nQ ?')).toBe(true)
  })
})

describe('citations', () => {
  it('numéros cités, bornés, formats groupés', () => {
    expect(citedNumbers('a [1] b [2, 3] c [3][9] d [x]', 3)).toEqual([1, 2, 3])
    expect(stripUnknownRefs('a [1] b [7] c [2, 9]', 3)).toBe('a [1] b  c [2]')
  })
  it('toCitations : extrait tronqué, champs complets', () => {
    const [c] = toCitations([hit(4, {}, 'y'.repeat(900))], 100)
    expect(c).toMatchObject({ n: 1, code: 'TVA', article: '4', version: '2026', outdated: false, url: 'https://jibaya.tn/4.pdf' })
    expect(c.excerpt.length).toBe(101)
  })
})

describe('askFiscalAssistant', () => {
  const hits = [hit(1), hit(2), hit(3, { outdated: true })]
  const retrieveImpl = jest.fn()
  beforeEach(() => { retrieveImpl.mockReset(); retrieveImpl.mockResolvedValue({ hits, mode: 'hybrid' }) })

  it('réponse citée : seules les sources citées sont renvoyées, avertissement ajouté', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(gemini('Le taux normal est de 19 % [2]. Voir aussi [1][8].'))
    const r = await askFiscalAssistant('Quel taux de TVA ?', { db, providers: [gem], fetchImpl, retrieveImpl })
    expect(r.status).toBe('ok')
    expect(r.provider).toBe('gemini')
    expect(r.citations.map((c) => c.n)).toEqual([1, 2])
    expect(r.answer).not.toContain('[8]')
    expect(r.answer).toContain(DISCLAIMER.fr)
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.systemInstruction.parts[0].text).toContain('UNIQUEMENT')
    expect(body.contents[0].parts[0].text).toContain('[3]')
  })

  it('aucun extrait → refus sans appel IA', async () => {
    retrieveImpl.mockResolvedValue({ hits: [], mode: 'fulltext' })
    const fetchImpl = jest.fn()
    const r = await askFiscalAssistant('ما هو الطابع الجبائي؟', { db, providers: [gem], fetchImpl, retrieveImpl })
    expect(r).toMatchObject({ status: 'no_sources', lang: 'ar', citations: [] })
    expect(r.answer).toContain(REFUSAL.ar)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('réponse sans aucune citation → refus prudent', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(gemini('Le taux est de 7 %.'))
    const r = await askFiscalAssistant('What is the VAT rate?', { db, providers: [gem], fetchImpl, retrieveImpl })
    expect(r.answer.startsWith(REFUSAL.en)).toBe(true)
    expect(r.answer).not.toContain('7 %')
  })

  it('Gemini en échec → repli Groq ; tous en échec → extraits seuls ; contenu jamais journalisé', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: '<think>x</think>Taux 19 % [1].' } }] }) })
    const r = await askFiscalAssistant('SECRET-QUESTION taux TVA', { db, providers: [gem, groq], fetchImpl, retrieveImpl })
    expect(r).toMatchObject({ status: 'ok', provider: 'groq' })
    expect(r.answer).not.toContain('think')
    const failing = jest.fn().mockResolvedValue({ ok: false, status: 500 })
    const r2 = await askFiscalAssistant('SECRET-QUESTION taux TVA', { db, providers: [gem, groq], fetchImpl: failing, retrieveImpl })
    expect(r2).toMatchObject({ status: 'retrieval_only', provider: null })
    expect(r2.citations).toHaveLength(3)
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET')
    warn.mockRestore()
  })

  it('sans fournisseur IA → extraits seuls', async () => {
    const r = await askFiscalAssistant('taux TVA', { db, providers: [], fetchImpl: jest.fn(), retrieveImpl })
    expect(r.status).toBe('retrieval_only')
  })
})
