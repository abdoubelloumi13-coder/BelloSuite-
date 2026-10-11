import { queryTerms, shortCitation, snippetFor, splitAnswer } from '@/lib/fiscal-search-utils'

describe('fiscal-search-utils', () => {
  it('queryTerms : mots significatifs, sans mots-outils ni diacritiques', () => {
    expect(queryTerms('Quel est le taux de la TVA en 2026 ?')).toEqual(['taux', 'tva', '2026'])
    expect(queryTerms('ما هي نِسبة الأداء')).toEqual(['نسبة', 'الأداء'])
  })
  it('snippetFor : centré sur le premier terme trouvé, avec ellipses', () => {
    const text = `${'a '.repeat(300)}le droit de timbre est fixé ${'b '.repeat(300)}`
    const s = snippetFor(text, 'timbre', 100)
    expect(s).toContain('timbre')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(snippetFor('court', 'x')).toBe('court')
  })
  it('splitAnswer : texte et références [n]', () => {
    expect(splitAnswer('Taux 19 % [1, 2]. Fin [3]')).toEqual([
      { type: 'text', text: 'Taux 19 % ' }, { type: 'ref', n: 1 }, { type: 'ref', n: 2 }, { type: 'text', text: '. Fin ' }, { type: 'ref', n: 3 },
    ])
  })
  it('shortCitation', () => {
    expect(shortCitation({ code: 'TVA', article: '7', version: '2026' }, 'fr')).toBe('TVA art. 7 · 2026')
    expect(shortCitation({ code: 'LF2026', article: null, version: '2026' }, 'en')).toBe('LF2026 · 2026')
  })
})
