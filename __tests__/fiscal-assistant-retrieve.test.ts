/** retrieve() : versions en vigueur d'abord, versions antérieures seulement en complément ; un seul embedding. */
const searchFiscalKb = jest.fn()
const embedQuery = jest.fn()
jest.mock('@/lib/fiscal-kb', () => ({
  ...jest.requireActual('@/lib/fiscal-kb'),
  searchFiscalKb: (...a: unknown[]) => searchFiscalKb(...a),
  embedQuery: (...a: unknown[]) => embedQuery(...a),
}))
import { retrieve } from '@/lib/fiscal-assistant'

const h = (id: string, outdated: boolean) => ({ id, content: id, section: null, score: 1, matchedBy: ['fulltext'], citation: { label: id, code: 'TVA', article: null, version: outdated ? '2017' : '2026', lang: 'fr', url: 'u', outdated } })
const db = { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() }

beforeEach(() => { searchFiscalKb.mockReset(); embedQuery.mockReset() })

it('assez de textes en vigueur → pas de recherche des versions antérieures', async () => {
  embedQuery.mockResolvedValue([0.1, 0.2])
  searchFiscalKb.mockResolvedValue({ mode: 'hybrid', hits: [h('a', false), h('b', false), h('c', false)] })
  const r = await retrieve('q', { db, embed: { apiKey: 'k' } as never })
  expect(r.hits.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  expect(searchFiscalKb).toHaveBeenCalledTimes(1)
  expect(searchFiscalKb.mock.calls[0][1]).toMatchObject({ queryVector: [0.1, 0.2], embed: null })
  expect(searchFiscalKb.mock.calls[0][2]).toMatchObject({ outdated: 'exclude' })
  expect(embedQuery).toHaveBeenCalledTimes(1)
})

it('peu de textes en vigueur → complété par des versions antérieures signalées ; embedding en échec → plein texte', async () => {
  embedQuery.mockRejectedValue(new Error('429'))
  searchFiscalKb
    .mockResolvedValueOnce({ mode: 'fulltext', hits: [h('a', false)] })
    .mockResolvedValueOnce({ mode: 'fulltext', hits: [h('a', false), h('old', true)] })
  const r = await retrieve('q', { db, embed: { apiKey: 'k' } as never })
  expect(r.hits.map((x) => [x.id, x.citation.outdated])).toEqual([['a', false], ['old', true]])
  expect(searchFiscalKb.mock.calls[0][1].queryVector).toBeNull()
})
