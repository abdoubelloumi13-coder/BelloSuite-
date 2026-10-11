/**
 * Speech-to-Devis : analyse DÉTERMINISTE d'une dictée (« 3 rouleaux de tissu denim à 12,5 dinars, dix chemises… »)
 * et rapprochement avec le catalogue du tenant (produits, clients).
 * Pur (aucun accès réseau / base, rien de journalisé) : utilisable côté serveur (repli sans IA, validation de la
 * réponse IA) comme côté client.
 * Langues : français (nombres en lettres, « 12,5 », « 12 dinars 500 »), anglais de base, arabe / derja de base
 * (chiffres arabes-indiens, nombres en lettres courants : زوز، ثلاثة، عشرة…).
 */

// ─── Types ──────────────────────────────────────────────────

export type CatalogProduct = { id: string; name: string; reference?: string | null; unitPrice?: number | null; vatRate?: number | null }
export type CatalogClient = { id: string; name: string }
export type Catalog = { products: CatalogProduct[]; clients: CatalogClient[] }

export type DictatedLine = {
  productId: string | null
  description: string
  quantity: number
  unitPrice: number | null
  discount: number | null
  vatRate: number | null
  /** unité reconnue (M, KG, L, ROUL…) ou null */
  unit?: string | null
}

export type DictatedQuote = {
  clientId: string | null
  clientName: string | null
  lines: DictatedLine[]
  notes: string | null
  validityDays: number | null
}

export const MAX_TRANSCRIPT = 5000
export const VALID_VAT = [0, 7, 13, 19]

// ─── Normalisation ──────────────────────────────────────────

const AR_DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

/** minuscules, sans accents latins ni harakat, chiffres arabes → latins, variantes d'alif / ta marbuta unifiées. */
export function normalize(s: string): string {
  return s
    .replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d)
    .replace(/٫/g, ',')
    .replace(/،/g, ',')
    .replace(/؛/g, ';')
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ـ/g, '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── Nombres en lettres ─────────────────────────────────────

/** Valeurs < 100 (additives) ; 100 / 1000 / 12 (douzaine) sont des multiplicateurs. */
const SMALL: Record<string, number> = {
  // fr
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10,
  onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30,
  quarante: 40, cinquante: 50, soixante: 60, septante: 70, huitante: 80, nonante: 90,
  // en
  one: 1, two: 2, three: 3, four: 4, five: 5, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // ar / derja (forme normalisée : ة→ه, أ→ا)
  'واحد': 1, 'وحده': 1, 'اثنين': 2, 'اثنان': 2, 'زوز': 2, 'جوج': 2, 'ثلاثه': 3, 'ثلاث': 3, 'تلاته': 3, 'ثلاثة': 3,
  'اربعه': 4, 'اربع': 4, 'خمسه': 5, 'خمس': 5, 'سته': 6, 'ست': 6, 'سبعه': 7, 'سبع': 7, 'ثمانيه': 8, 'ثمنيه': 8,
  'تمنيه': 8, 'ثمان': 8, 'تسعه': 9, 'تسع': 9, 'عشره': 10, 'عشر': 10, 'عشرين': 20, 'ثلاثين': 30, 'تلاتين': 30,
  'اربعين': 40, 'خمسين': 50, 'ستين': 60, 'سبعين': 70, 'ثمانين': 80, 'تسعين': 90,
}
const MULT: Record<string, number> = {
  cent: 100, cents: 100, hundred: 100, 'ميه': 100, 'مائه': 100, 'مئه': 100, 'مية': 100,
  mille: 1000, milles: 1000, thousand: 1000, 'الف': 1000, 'الاف': 1000,
  douzaine: 12, douzaines: 12, dozen: 12, dozens: 12,
}
const DECIMAL_WORDS = new Set(['virgule', 'point', 'فاصل', 'فاصله'])

function wordValue(w: string): { kind: 'small' | 'mult'; v: number } | null {
  if (w in SMALL) return { kind: 'small', v: SMALL[w] }
  if (w in MULT) return { kind: 'mult', v: MULT[w] }
  // conjonction arabe collée : « وخمسه » = « و خمسه »
  if (w.length > 2 && w.startsWith('و')) {
    const r = w.slice(1)
    if (r in SMALL) return { kind: 'small', v: SMALL[r] }
    if (r in MULT) return { kind: 'mult', v: MULT[r] }
  }
  return null
}

/**
 * Remplace les suites de nombres en lettres par leur valeur en chiffres
 * (« vingt et un » → 21, « quatre-vingt-dix » → 90, « douze virgule cinq » → 12.5, « خمسه وعشرين » → 25).
 * Le texte doit être normalisé.
 */
export function wordsToDigits(text: string): string {
  const tokens = text.replace(/(\p{L})-(?=\p{L})/gu, '$1 ').split(' ')
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    const first = wordValue(tokens[i])
    if (!first) { out.push(tokens[i]); i++; continue }
    let total = 0
    let cur = 0
    let j = i
    let seen = false
    while (j < tokens.length) {
      const w = tokens[j]
      const wv = wordValue(w)
      if (wv) {
        if (wv.kind === 'small') {
          if (wv.v === 20 && cur > 0 && cur < 10 && (tokens[j - 1] === 'quatre')) cur = cur * 20
          else cur += wv.v
        } else if (wv.v === 1000) { total += (cur || 1) * 1000; cur = 0 }
        else cur = (cur || 1) * wv.v
        seen = true
        j++
        continue
      }
      // « vingt et un », « soixante et onze », « خمسه و عشرين »
      if ((w === 'et' || w === 'and' || w === 'و') && seen && j + 1 < tokens.length) {
        const nx = wordValue(tokens[j + 1])
        if (nx && nx.kind === 'small' && (w !== 'et' || nx.v === 1 || nx.v === 11)) { j++; continue }
      }
      break
    }
    let value = String(total + cur)
    // partie décimale : « douze virgule cinq » → 12.5 ; « 12 virgule 5 »
    if (j + 1 < tokens.length && DECIMAL_WORDS.has(tokens[j])) {
      const d = tokens[j + 1]
      if (/^\d+$/.test(d)) { value += '.' + d; j += 2 } else {
        const dv = wordValue(d)
        if (dv && dv.kind === 'small') {
          let k = j + 1
          let dec = 0
          while (k < tokens.length) { const x = wordValue(tokens[k]); if (!x || x.kind !== 'small') break; dec += x.v; k++ }
          value += '.' + String(dec)
          j = k
        }
      }
    }
    out.push(value)
    i = j
  }
  // « 12 virgule 5 » (chiffres déjà présents)
  return out.join(' ').replace(/(\d+) (?:virgule|point|فاصل|فاصله) (\d+)/g, '$1.$2')
}

// ─── Rapprochement approximatif ─────────────────────────────

function stem(t: string): string {
  let w = t
  if (/^ال\S{3,}/.test(w)) w = w.slice(2)
  if (w.length > 4 && /aux$/.test(w)) w = w.slice(0, -3) + 'au'
  else if (w.length > 3 && /[sx]$/.test(w)) w = w.slice(0, -1)
  return w
}

const STOP = new Set(['de', 'du', 'des', 'd', 'la', 'le', 'les', 'l', 'en', 'a', 'au', 'aux', 'et', 'pour', 'avec', 'the', 'of', 'for', 'with', 'and', 'من', 'في', 'و'])

export function tokens(s: string): string[] {
  return normalize(s).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((t) => t && !STOP.has(t)).map(stem)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, k) => k)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[n]
}

function tokenSim(a: string, b: string): number {
  if (a === b) return 1
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.9
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length)
}

function coverage(from: string[], to: string[]): number {
  if (!from.length) return 0
  let s = 0
  for (const f of from) s += Math.max(0, ...to.map((t) => tokenSim(f, t))) >= 0.8 ? 1 : 0
  return s / from.length
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  const x = s.replace(/\s+/g, '')
  for (let i = 0; i < x.length - 1; i++) { const g = x.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1) }
  return m
}

function dice(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b)
  let inter = 0, na = 0, nb = 0
  for (const v of A.values()) na += v
  for (const v of B.values()) nb += v
  for (const [g, v] of A) inter += Math.min(v, B.get(g) ?? 0)
  return na + nb ? (2 * inter) / (na + nb) : 0
}

/** Similarité 0..1 entre un texte dicté et un libellé du catalogue. */
export function similarity(spoken: string, label: string): number {
  const a = tokens(spoken), b = tokens(label)
  if (!a.length || !b.length) return 0
  const tokScore = (coverage(a, b) + coverage(b, a)) / 2
  return Math.max(tokScore, dice(a.join(' '), b.join(' ')))
}

export const PRODUCT_MATCH_THRESHOLD = 0.6
export const CLIENT_MATCH_THRESHOLD = 0.6

/** Meilleur produit du catalogue pour un libellé dicté (référence exacte prioritaire), ou null. */
export function matchProduct(spoken: string, products: CatalogProduct[]): { product: CatalogProduct; score: number } | null {
  const sTokens = new Set(normalize(spoken).split(/[^\p{L}\p{N}-]+/u))
  let best: { product: CatalogProduct; score: number } | null = null
  for (const p of products) {
    const ref = p.reference ? normalize(p.reference) : ''
    let score = ref && ref.length >= 2 && sTokens.has(ref) ? 1 : similarity(spoken, p.name)
    if (score < 1 && ref) score = Math.max(score, similarity(spoken, `${p.name} ${ref}`) * 0.98)
    if (!best || score > best.score) best = { product: p, score }
  }
  return best && best.score >= PRODUCT_MATCH_THRESHOLD ? best : null
}

export function matchClient(spoken: string, clients: CatalogClient[]): { client: CatalogClient; score: number } | null {
  let best: { client: CatalogClient; score: number } | null = null
  for (const c of clients) {
    const score = similarity(spoken, c.name)
    if (!best || score > best.score) best = { client: c, score }
  }
  return best && best.score >= CLIENT_MATCH_THRESHOLD ? best : null
}

// ─── Analyse locale (sans IA) ───────────────────────────────

const NUM = String.raw`\d+(?:\.\d+)?`
const CURRENCY = String.raw`(?:dinars?|dt|tnd|د\.?ت|دينار|دنانير|دينارات|مليم)`
const UNIT_WORDS: Array<[RegExp, string]> = [
  [/^(?:rouleaux?|rlx|rolls?|رول|رولو|رولوات)$/, 'ROUL'],
  [/^(?:metres?|m|meters?|mitres?|متر|امتار|ميترو)$/, 'M'],
  [/^(?:kilos?|kg|kilogrammes?|كيلو|كلغ)$/, 'KG'],
  [/^(?:litres?|l|liters?|لتر|ليتر)$/, 'L'],
  [/^(?:pieces?|pcs?|unites?|units?|قطعه|قطع|حبه|حبات)$/, 'PCE'],
  [/^(?:cartons?|boites?|boxes?|كرتونه|كراتن)$/, 'CART'],
  [/^(?:paquets?|packs?|باكو|باكوات)$/, 'PAQ'],
]
const LEAD_IN = /^(?:(?:je veux|je voudrais|fais(?:-moi)?|faire|cree|creer|nouveau|un|le|ajoute|ajouter|mettre|mets|create|make|new|add|a|اعمل|اعملي|زيد)\s+)*(?:(?:un|le|a)\s+)?(?:devis|quote|quotation|estimate|facture|invoice|commande|order|bon de livraison|دوفي|فاتوره|عرض سعر)\b\s*:?\s*/

function unitOf(word: string): string | null {
  for (const [re, u] of UNIT_WORDS) if (re.test(word)) return u
  return null
}

function round3(n: number) { return Math.round(n * 1000) / 1000 }

/** Retire un motif du texte et renvoie ses groupes (premier match seulement). */
function take(text: string, re: RegExp): { text: string; m: RegExpMatchArray | null } {
  const m = text.match(re)
  if (!m || m.index === undefined) return { text, m: null }
  return { text: (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(), m }
}

function parseLine(seg: string, products: CatalogProduct[]): DictatedLine | null {
  let s = ` ${seg} `
  let discount: number | null = null
  let vatRate: number | null = null
  let unitPrice: number | null = null

  let r = take(s, new RegExp(String.raw`(?:remise|rabais|reduction|discount|تخفيض|خصم|ريميز)\s*(?:de|of)?\s*(${NUM})\s*(?:%|pour ?cent|percent|بالميه|بالمائه|في الميه)?`))
  if (!r.m) r = take(s, new RegExp(String.raw`(${NUM})\s*(?:%|pour ?cent|percent|بالميه)\s*(?:de\s*)?(?:remise|rabais|reduction|discount|تخفيض|خصم)`))
  if (r.m) { discount = Math.min(100, Number(r.m[1])); s = ` ${r.text} ` }

  r = take(s, new RegExp(String.raw`(?:tva|vat|الاداء)\s*(?:de|a|of|at)?\s*(${NUM})\s*(?:%|pour ?cent|percent)?`))
  if (r.m && VALID_VAT.includes(Number(r.m[1]))) { vatRate = Number(r.m[1]); s = ` ${r.text} ` }

  // « 12 dinars 500 » = 12,500 DT
  s = s.replace(new RegExp(String.raw`(\d+)\s*(?:dinars?|dt|دينار|دنانير)\s+(\d{1,3})(?:\s*(?:millimes?|مليم))?(?=\s|$)`), (_, d: string, m: string) => ` ${Number(d) + Number(m.padEnd(3, '0')) / 1000} dt `)

  // prix : « à 12.5 (dinars) », « au prix de 12 », « pour 30 dt », « بـ 12 دينار », « 12 dinars »
  r = take(s, new RegExp(String.raw`\s(?:a|au prix(?: unitaire)? de|prix(?: unitaire)?|pour|at|@|for|بسوم|بسعر|السعر|ب|بـ)\s*(${NUM})\s*${CURRENCY}?(?:\s+(?:l'unite|l unite|la piece|piece|chacun|chacune|each|unit|par\s+\S+|le\s+\S+|la\s+\S+|الواحد|الواحده|للواحد))?(?=\s|$)`))
  if (!r.m) r = take(s, new RegExp(String.raw`\s(?:ب|بـ)(${NUM})\s*${CURRENCY}?(?=\s|$)`))
  if (!r.m) r = take(s, new RegExp(String.raw`\s(${NUM})\s*${CURRENCY}(?:\s+(?:l'unite|l unite|la piece|piece|chacun|chacune|each|unit|par\s+\S+|le\s+\S+|la\s+\S+|الواحد|للواحد))?(?=\s|$)`))
  if (r.m) { unitPrice = round3(Number(r.m[1])); s = ` ${r.text} ` }

  // quantité : premier nombre restant (éventuellement « x3 » / « 3x »)
  let quantity: number | null = null
  r = take(s, new RegExp(String.raw`(?:^|\s)(?:x\s*)?(${NUM})\s*(?:x(?=\s))?`))
  if (r.m) { quantity = Number(r.m[1]); s = ` ${r.text} ` }
  // nombre restant sans marqueur alors qu'aucun prix : c'est le prix
  if (unitPrice === null) {
    r = take(s, new RegExp(String.raw`(?:^|\s)(${NUM})(?=\s|$)`))
    if (r.m) { unitPrice = round3(Number(r.m[1])); s = ` ${r.text} ` }
  }

  // unité puis « de / d' / des / من »
  let words = s.trim().split(' ').filter(Boolean)
  let unit: string | null = null
  if (words.length && unitOf(words[0])) { unit = unitOf(words[0]); words = words.slice(1) }
  while (words.length && /^(?:de|d'|des|du|of|من|x)$/.test(words[0])) words = words.slice(1)
  if (words.length && /^d'/.test(words[0])) words[0] = words[0].slice(2)
  while (words.length && /^(?:de|des|du|et|a|pour|chacun|chacune|each|و)$/.test(words[words.length - 1])) words.pop()
  const description = words.join(' ').replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '').trim()

  if (!description) return null
  const match = matchProduct(description, products)
  if (quantity === null) {
    // segment sans nombre : seulement s'il désigne clairement un produit (ou porte un prix)
    if (!match && unitPrice === null) return null
    quantity = 1
  }
  if (!(quantity > 0)) return null
  return {
    productId: match?.product.id ?? null,
    description: match ? match.product.name : description.slice(0, 300),
    quantity: round3(quantity),
    unitPrice,
    discount,
    vatRate,
    unit,
  }
}

/**
 * Analyse déterministe d'une dictée. Le texte n'est ni stocké ni journalisé.
 * Reconnaît : client (« pour le client X », « client X », un nom de client du catalogue cité tel quel),
 * lignes (« 3 rouleaux de tissu denim à 12,5 dinars », « dix chemises », « 2 m de doublure à 4 dt remise 10 % »),
 * validité (« valable 30 jours ») et note (« note : … »).
 */
export function parseDictationLocal(transcript: string, catalog: Catalog): DictatedQuote {
  let text = normalize(transcript.slice(0, MAX_TRANSCRIPT))
  // décimales « 12,5 » / « 12.5 » → point ; virgules restantes = séparateurs
  text = text.replace(/(\d)\s?,\s?(\d)/g, '$1.$2')
  text = wordsToDigits(text)

  // note libre en fin de dictée
  let notes: string | null = null
  let r = take(text, /(?:^|[\s,.;])(?:note|notes|remarque|observation|ملاحظه)\s*:?\s+(.+)$/)
  if (r.m) { notes = r.m[1].trim().slice(0, 500) || null; text = r.text }

  // validité
  let validityDays: number | null = null
  r = take(text, /(?:valable|validite|valide|valid(?:ity)?(?: for)?|صالح(?:ه)?(?: لمده)?|مده الصلاحيه)\s*(?:de|pendant|of|:)?\s*(\d+)\s*(?:jours?|days?|يوم|ايام)/)
  if (r.m) { validityDays = Math.min(365, Number(r.m[1])); text = r.text }

  text = text.replace(LEAD_IN, '')

  // client : nom du catalogue cité tel quel (le plus long gagne), sinon « pour le client X » / « client X »
  let clientId: string | null = null
  let clientName: string | null = null
  const byLength = [...catalog.clients].sort((a, b) => b.name.length - a.name.length)
  for (const c of byLength) {
    const n = normalize(c.name)
    if (n.length < 3) continue
    const idx = text.indexOf(n)
    if (idx >= 0) {
      clientId = c.id; clientName = c.name
      text = (text.slice(0, idx) + ' ' + text.slice(idx + n.length)).replace(/(?:^|\s)(?:pour|client|chez|au nom de|for|customer|للحريف|الحريف|حريف|للشركه|لشركه|العميل)(?:\s+(?:le|la|l'|the))?(?:\s+(?:client|societe|ste|entreprise|customer))?\s*:?\s*(?=\s|,|$)/, ' ')
      break
    }
  }
  if (!clientId) {
    const NAME = String.raw`\s*:?\s*(?!\d)([^\d,;:.]{2,60}?)(?=\s*[,;:.]|\s+\d|\s+(?:avec|with|qui|مع)\s|$)`
    r = take(text, new RegExp(String.raw`(?:^|[\s,.;])(?:pour\s+(?:le\s+|la\s+|l')?(?:client|societe|ste|entreprise|ets|sarl)|client|au nom de|for\s+(?:the\s+)?customer|customer|للحريف|الحريف|حريف|للشركه|لشركه|العميل)` + NAME))
    // « devis pour Textiles Sfax : 3 rouleaux… » (en tête de dictée)
    if (!r.m) r = take(text, new RegExp(String.raw`^(?:pour|for|لـ?)\s+` + NAME))
    if (r.m) {
      const cand = r.m[1].trim()
      const m = matchClient(cand, catalog.clients)
      if (m) { clientId = m.client.id; clientName = m.client.name } else clientName = cand.slice(0, 120)
      text = r.text
    }
  }

  // segments : virgules / points-virgules / « et|puis|plus|و » suivis d'un nombre
  const segments = text
    .split(/\s*[;:,\n]\s*|\.\s+|\s+(?:et|puis|plus|ainsi que|aussi|and|then|also|ثم|و)\s+(?=\d)|\s+و(?=\d)/)
    .map((x) => x.trim())
    .filter(Boolean)

  const lines: DictatedLine[] = []
  for (const seg of segments) {
    const l = parseLine(seg, catalog.products)
    if (l) lines.push(l)
    if (lines.length >= 100) break
  }
  return { clientId, clientName, lines, notes, validityDays }
}

// ─── Validation d'une réponse IA (ids du tenant uniquement) ───

/**
 * Rend une proposition (IA ou autre) sûre : seuls les ids présents dans le catalogue du tenant sont gardés,
 * un produit / client non identifié est rapproché par son libellé, quantités et prix bornés.
 */
export function finalizeDictation(q: DictatedQuote, catalog: Catalog): DictatedQuote {
  const pIds = new Map(catalog.products.map((p) => [p.id, p]))
  const cIds = new Map(catalog.clients.map((c) => [c.id, c]))
  let clientId = q.clientId && cIds.has(q.clientId) ? q.clientId : null
  let clientName = q.clientName?.trim() || null
  if (clientId) clientName = cIds.get(clientId)!.name
  else if (clientName) {
    const m = matchClient(clientName, catalog.clients)
    if (m) { clientId = m.client.id; clientName = m.client.name }
  }
  const lines: DictatedLine[] = []
  for (const l of q.lines.slice(0, 100)) {
    const quantity = Number(l.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1e7) continue
    let product = l.productId ? pIds.get(l.productId) ?? null : null
    if (!product && l.description) product = matchProduct(l.description, catalog.products)?.product ?? null
    const description = (l.description?.trim() || product?.name || '').slice(0, 300)
    if (!description && !product) continue
    const price = l.unitPrice == null ? null : Number(l.unitPrice)
    const disc = l.discount == null ? null : Number(l.discount)
    const vat = l.vatRate == null ? null : Number(l.vatRate)
    lines.push({
      productId: product?.id ?? null,
      description: product && !l.description?.trim() ? product.name : description,
      quantity: round3(quantity),
      unitPrice: price !== null && Number.isFinite(price) && price >= 0 && price < 1e9 ? round3(price) : null,
      discount: disc !== null && Number.isFinite(disc) && disc > 0 && disc <= 100 ? disc : null,
      vatRate: vat !== null && VALID_VAT.includes(vat) ? vat : null,
      unit: l.unit ?? null,
    })
  }
  const vd = q.validityDays == null ? null : Math.round(Number(q.validityDays))
  return {
    clientId,
    clientName,
    lines,
    notes: q.notes?.trim().slice(0, 500) || null,
    validityDays: vd !== null && Number.isFinite(vd) && vd > 0 && vd <= 365 ? vd : null,
  }
}

/** Langue de reconnaissance vocale par défaut selon la langue de l'interface. */
export function speechLangFor(locale: string): string {
  return locale === 'ar' ? 'ar-TN' : locale === 'en' ? 'en-US' : 'fr-FR'
}
