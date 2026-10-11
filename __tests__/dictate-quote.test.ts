/** Speech-to-Devis : analyse locale (nombres FR/AR, décimales, rapprochement catalogue) et validation IA. */
import { finalizeDictation, matchProduct, normalize, parseDictationLocal, speechLangFor, wordsToDigits, type Catalog } from '@/lib/dictate-quote'
import { parseDictationJson, buildDictationPrompt } from '@/lib/ai-dictate'

const catalog: Catalog = {
  products: [
    { id: 'p1', name: 'Tissu Denim 12oz', reference: 'TD-12', unitPrice: 10, vatRate: 19 },
    { id: 'p2', name: 'Chemise homme blanche', reference: 'CH-01', unitPrice: 25, vatRate: 19 },
    { id: 'p3', name: 'Fil polyester', reference: 'FP', unitPrice: 2, vatRate: 7 },
    { id: 'p4', name: 'قماش قطني', reference: 'QQ', unitPrice: 8, vatRate: 19 },
  ],
  clients: [{ id: 'c1', name: 'Textiles Sfax' }, { id: 'c2', name: 'Confection Monastir SARL' }],
}

const dig = (s: string) => wordsToDigits(normalize(s))

describe('nombres en lettres', () => {
  it('français', () => {
    expect(dig('dix chemises')).toBe('10 chemises')
    expect(dig('vingt et un')).toBe('21')
    expect(dig('quatre-vingt-dix mètres')).toBe('90 metres')
    expect(dig('soixante-quinze')).toBe('75')
    expect(dig('deux cent cinquante')).toBe('250')
    expect(dig('deux mille cinq cents')).toBe('2500')
    expect(dig('douze virgule cinq')).toBe('12.5')
    expect(dig('une douzaine de boutons')).toBe('12 de boutons')
  })
  it('arabe / derja de base et chiffres arabes-indiens', () => {
    expect(dig('زوز شميز')).toBe('2 شميز')
    expect(dig('خمسة وعشرين')).toBe('25')
    expect(dig('٣ قماش')).toBe('3 قماش')
  })
  it('anglais de base', () => {
    expect(dig('twenty five shirts')).toBe('25 shirts')
  })
})

describe('rapprochement produit', () => {
  it('approximatif, pluriels, référence exacte', () => {
    expect(matchProduct('tissu denim', catalog.products)?.product.id).toBe('p1')
    expect(matchProduct('chemises', catalog.products)?.product.id).toBe('p2')
    expect(matchProduct('fil polyestere', catalog.products)?.product.id).toBe('p3')
    expect(matchProduct('article td-12', catalog.products)?.product.id).toBe('p1')
    expect(matchProduct('boutons nacre', catalog.products)).toBeNull()
  })
})

describe('parseDictationLocal', () => {
  it('dictée française complète', () => {
    const r = parseDictationLocal('Devis pour le client Textile Sfax : 3 rouleaux de tissu denim à 12,5 dinars, dix chemises et vingt et une bobines de fil polyester à 2 dinars 500. Valable 30 jours. Note : livraison sous huitaine', catalog)
    expect(r.clientId).toBe('c1')
    expect(r.validityDays).toBe(30)
    expect(r.notes).toBe('livraison sous huitaine')
    expect(r.lines).toEqual([
      expect.objectContaining({ productId: 'p1', quantity: 3, unitPrice: 12.5, unit: 'ROUL' }),
      expect.objectContaining({ productId: 'p2', quantity: 10, unitPrice: null }),
      expect.objectContaining({ productId: 'p3', quantity: 21, unitPrice: 2.5 }),
    ])
  })
  it('décimale 12.5, remise, unité, ligne libre', () => {
    const r = parseDictationLocal('quatre-vingt-dix mètres de tissu denim à 9.75 dt remise de 5 %, 4 boutons nacre à 0,350', catalog)
    expect(r.lines[0]).toMatchObject({ productId: 'p1', quantity: 90, unitPrice: 9.75, discount: 5, unit: 'M' })
    expect(r.lines[1]).toMatchObject({ productId: null, description: 'boutons nacre', quantity: 4, unitPrice: 0.35 })
  })
  it('client en tête de dictée sans mot « client »', () => {
    const r = parseDictationLocal('pour Confection Monastir, deux cent cinquante chemises à douze virgule cinq dinars', catalog)
    expect(r.clientId).toBe('c2')
    expect(r.lines[0]).toMatchObject({ productId: 'p2', quantity: 250, unitPrice: 12.5 })
  })
  it('client inconnu : nom gardé, id null', () => {
    const r = parseDictationLocal('devis pour le client Atelier Nabeul, 2 chemises', catalog)
    expect(r.clientId).toBeNull()
    expect(r.clientName).toBe('atelier nabeul')
  })
  it('derja : chiffres arabes, « زوز », prix « ب »', () => {
    const r = parseDictationLocal('للحريف Textiles Sfax ٣ قماش قطني ب 12 دينار و زوز شميز', catalog)
    expect(r.clientId).toBe('c1')
    expect(r.lines[0]).toMatchObject({ productId: 'p4', quantity: 3, unitPrice: 12 })
    expect(r.lines[1]).toMatchObject({ productId: null, quantity: 2 })
  })
  it('texte vide / sans ligne', () => {
    expect(parseDictationLocal('bonjour', catalog).lines).toEqual([])
  })
})

describe('validation d’une proposition IA', () => {
  it('ids étrangers au tenant ignorés, rapprochement par libellé, bornes', () => {
    const r = finalizeDictation({
      clientId: 'autre-tenant', clientName: 'textiles sfax', notes: '  ', validityDays: 9999,
      lines: [
        { productId: 'p-x', description: 'tissu denim', quantity: 2, unitPrice: null, discount: 150, vatRate: 18 },
        { productId: null, description: 'ok', quantity: -1, unitPrice: 1, discount: null, vatRate: null },
      ],
    }, catalog)
    expect(r).toMatchObject({ clientId: 'c1', notes: null, validityDays: null })
    expect(r.lines).toEqual([expect.objectContaining({ productId: 'p1', quantity: 2, discount: null, vatRate: null })])
  })
  it('JSON IA : montants TN en chaîne, ```json toléré', () => {
    const q = parseDictationJson('```json\n{"clientId":"c1","lines":[{"productId":"p1","description":"denim","quantity":"3","unitPrice":"12,500 DT"}],"validityDays":15}\n```')
    expect(q?.lines[0]).toMatchObject({ productId: 'p1', quantity: 3, unitPrice: 12.5 })
    expect(parseDictationJson('pas de json')).toBeNull()
  })
  it('prompt : catalogue compact + dictée', () => {
    const p = buildDictationPrompt('3 chemises', catalog)
    expect(p).toContain('p2|Chemise homme blanche|CH-01|25|19')
    expect(p).toContain('c1|Textiles Sfax')
    expect(p).toContain('3 chemises')
  })
  it('langue de reconnaissance par locale', () => {
    expect(speechLangFor('ar')).toBe('ar-TN')
    expect(speechLangFor('en')).toBe('en-US')
    expect(speechLangFor('fr')).toBe('fr-FR')
  })
})
