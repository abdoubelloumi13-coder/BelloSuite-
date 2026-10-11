/**
 * Affinage IA OPTIONNEL de l'extraction de facture fournisseur (côté serveur).
 * Fournisseurs gratuits pris en charge, essayés dans cet ordre (le second sert de repli) :
 *  - Google AI Studio (Gemini) : env GEMINI_API_KEY, modèle env GEMINI_MODEL (défaut gemini-3.5-flash-lite : palier gratuit, recommandé par Google pour les nouveaux projets — oct. 2026)
 *  - Groq (OpenAI-compatible)  : env GROQ_API_KEY,   modèle env GROQ_MODEL   (défaut qwen/qwen3.8-27b, vision)
 * Sans clé : `aiProvider()` renvoie null et la fonctionnalité reste 100 % déterministe.
 * Le contenu de la facture n'est jamais journalisé ni stocké.
 */
import { z } from 'zod'
import { near, parseAmount, round3, type AiInvoice, type InvoiceExtraction } from '@/lib/invoice-extract'

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash-lite'
export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b'
const TIMEOUT_MS = 25_000
/** Appels HTTP max par fournisseur et par requête (nouvelle tentative sans schéma ou relance « incomplet » comprises). */
export const MAX_CALLS_PER_PROVIDER = 2

// ─── Nombres renvoyés par l'IA ──────────────────────────────

const CURRENCY_RE = /(TND|D\.T\.?|DT|dinars?|دينار|د\.ت)/gi
/** « 7.344 » : un seul point suivi de 3 chiffres — milliers (FR) ou millimes (TN) ? */
const AMBIGUOUS_RE = /^-?\d{1,3}\.\d{3}$/

function cleanAmountString(v: string): string {
  return v.replace(CURRENCY_RE, '').replace(/[\u00a0\u202f\u2009\s']/g, '').trim()
}

/**
 * Montant IA → nombre. Accepte un nombre JSON ou une chaîne au format TN / FR / EN
 * (« 7.344,609 », « 7 344,609 », « 6110,000 DT », « 1,250.000 », « TND 12 »). Illisible → null.
 * Réutilise `parseAmount` de l'extraction déterministe ; « 7.344 » est lu 7,344 (millimes) sauf contexte (voir resolveAmbiguous).
 */
export function coerceAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = cleanAmountString(v)
  if (!s || !/^[-+]?[\d.,]+$/.test(s) || !/\d/.test(s)) return null
  return parseAmount(s.replace(/^\+/, ''))
}

/** Lecture « milliers » d'une chaîne ambiguë (« 7.344 » → 7344), sinon null. */
function thousandsReading(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const s = cleanAmountString(v)
  return AMBIGUOUS_RE.test(s) ? Number(s.replace('.', '')) : null
}

/** Candidats d'une valeur : [lecture par défaut, lecture milliers si ambiguë]. */
function readings(v: unknown): number[] {
  const d = coerceAmount(v)
  if (d === null) return []
  const t = thousandsReading(v)
  return t !== null && t !== d ? [d, t] : [d]
}

/** Toutes les combinaisons (produit cartésien) de lectures, limité à 64. */
function combos(lists: number[][]): number[][] {
  let out: number[][] = [[]]
  for (const l of lists) {
    out = out.flatMap((c) => l.map((x) => [...c, x]))
    if (out.length > 64) return [lists.map((x) => x[0])]
  }
  return out
}

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Lève les ambiguïtés « 7.344 » par l'arithmétique : ligne (qté × PU ≈ total) et pied
 * (HT + FODEC + TVA + timbre ≈ TTC). Ne modifie que les champs ambigus ; renvoie le nombre de champs relus.
 */
export function resolveAmbiguous(raw: Raw): number {
  let changed = 0
  const apply = (obj: Raw, keys: string[], ok: (vals: Array<number | null>) => boolean) => {
    const lists = keys.map((k) => readings(obj[k]))
    if (!lists.some((l) => l.length > 1)) return
    const all = combos(lists.map((l) => (l.length ? l : [NaN])))
    const pick = all.find((c) => ok(c.map((x) => (Number.isNaN(x) ? null : x))))
    if (!pick) return
    keys.forEach((k, i) => {
      if (lists[i].length > 1 && pick[i] !== lists[i][0]) { obj[k] = pick[i]; changed++ }
    })
  }
  if (Array.isArray(raw.lines)) {
    for (const l of raw.lines) {
      if (!isObj(l)) continue
      apply(l, ['quantity', 'unitPrice', 'total'], ([q, pu, t]) => q !== null && pu !== null && t !== null && near(q * pu, t, Math.max(0.01, t * 0.002)))
    }
  }
  const vatSum = Array.isArray(raw.vat) ? raw.vat.reduce<number>((s, v) => s + (isObj(v) ? coerceAmount(v.amount) ?? 0 : 0), 0) : 0
  apply(raw, ['subtotal', 'fodec', 'vatTotal', 'stamp', 'total'], ([ht, fodec, vat, stamp, ttc]) =>
    ht !== null && ttc !== null && near(round3(ht + (fodec ?? 0) + (vat ?? vatSum) + (stamp ?? 0)), ttc))
  return changed
}

const num = z.unknown().transform((v, ctx) => {
  const n = coerceAmount(v)
  if (n === null) { ctx.addIssue({ code: 'custom', message: 'not_a_number' }); return z.NEVER }
  return n
})
const optNum = z.unknown().transform((v) => coerceAmount(v)).catch(null)
const optStr = z.string().trim().max(200).nullable().optional().catch(null)

const vatSchema = z.object({ rate: num, base: optNum, amount: num })
const lineSchema = z.object({
  reference: optStr,
  designation: z.string().trim().min(1).max(300),
  quantity: num,
  unitPrice: num,
  total: num,
})

/** Tableau tolérant : un élément invalide est retiré seul, les autres sont conservés. */
function lenientArray<T extends z.ZodType>(item: T, max: number) {
  return z.unknown().transform((v): Array<z.infer<T>> | null => {
    if (!Array.isArray(v)) return null
    const out: Array<z.infer<T>> = []
    for (const x of v.slice(0, max)) {
      const r = item.safeParse(x)
      if (r.success) out.push(r.data)
    }
    return out
  })
}

/** Schéma de la réponse IA (champs inconnus ignorés ; montant invalide → null ; ligne invalide → retirée seule). */
export const aiInvoiceSchema = z.object({
  documentType: optStr,
  supplierName: optStr,
  matriculeFiscal: optStr,
  invoiceNumber: optStr,
  date: optStr,
  subtotal: optNum,
  fodec: optNum,
  vat: lenientArray(vatSchema, 5),
  vatTotal: optNum,
  stamp: optNum,
  total: optNum,
  lines: lenientArray(lineSchema, 200),
})

export const extractRequestSchema = z.object({
  text: z.string().max(30_000).default(''),
  /** data:image/...;base64,... (≤ ~4 Mo une fois encodée) */
  image: z.string().max(4_200_000).regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/).nullable().optional(),
})

export type AiProvider = { name: 'gemini' | 'groq'; key: string; model: string }

/** Fournisseurs configurés, par ordre d'essai : Gemini puis Groq (repli). */
export function aiProviders(env: Record<string, string | undefined> = process.env): AiProvider[] {
  const out: AiProvider[] = []
  if (env.GEMINI_API_KEY) out.push({ name: 'gemini', key: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL })
  if (env.GROQ_API_KEY) out.push({ name: 'groq', key: env.GROQ_API_KEY, model: env.GROQ_MODEL || DEFAULT_GROQ_MODEL })
  return out
}

export function aiProvider(env: Record<string, string | undefined> = process.env): AiProvider | null {
  return aiProviders(env)[0] ?? null
}

export const PROMPT = `Tu extrais les données d'une pièce FOURNISSEUR tunisienne : facture, bon de commande, devis / proforma ou bon de livraison
(texte OCR éventuellement bruité, et/ou image).
Réponds UNIQUEMENT avec un objet JSON, sans texte autour, de la forme :
{"documentType":"facture"|"bon_de_commande"|"devis"|"bon_de_livraison"|null,
"supplierName":string|null,"matriculeFiscal":string|null,"invoiceNumber":string|null,"date":"YYYY-MM-DD"|null,
"subtotal":number|null,"fodec":number|null,"vat":[{"rate":7|13|19,"base":number|null,"amount":number}],"vatTotal":number|null,
"stamp":number|null,"total":number|null,"lines":[{"reference":string|null,"designation":string,"quantity":number,"unitPrice":number,"total":number}]}
Règles : documentType = nature de la pièce d'après son titre (« Facture proforma » = devis) ; invoiceNumber = numéro de la pièce
quel que soit son type (n° de facture, de BC, de devis ou de BL) ;
le fournisseur est l'ÉMETTEUR (pas le client) ; matricule fiscal au format 1234567X/A/M/000 ; montants en dinars,
nombres JSON SIMPLES (jamais de chaîne) avec point décimal et sans séparateur de milliers ni devise
(« 7.344,609 DT » → 7344.609 ; « 1 250,000 » → 1250) ; subtotal = total HT ; fodec = FODEC 1 % s'il existe ;
stamp = timbre fiscal (souvent 1 sur une facture, généralement absent d'un bon de commande ou d'un devis : null alors) ;
total = TTC / net à payer. N'invente rien : null si absent ou illisible.`

// ─── Analyse de la réponse + diagnostics (forme seulement, jamais de contenu) ───

export const NUMERIC_KEYS = ['subtotal', 'fodec', 'vatTotal', 'stamp', 'total'] as const

/** Diagnostic de forme d'une réponse IA : aucun texte ni montant, seulement des types, clés et chemins. */
export type AiDiagnostics = {
  /** type JSON brut de chaque montant du pied : 'number' | 'string' | 'null' | 'missing' | autre */
  numericTypes: Record<string, string>
  /** clés du résultat nulles ou absentes */
  nullKeys: string[]
  /** chemins des éléments rejetés (ex. « lines.2.quantity:custom ») */
  issues: string[]
  linesIn: number
  linesKept: number
  stringNumbers: number
  ambiguousResolved: number
}

const typeOf = (v: unknown) => (v === undefined ? 'missing' : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

function countStringNumbers(raw: Raw): number {
  let n = NUMERIC_KEYS.filter((k) => typeof raw[k] === 'string').length
  for (const arr of [raw.lines, raw.vat]) {
    if (!Array.isArray(arr)) continue
    for (const x of arr) if (isObj(x)) n += Object.values(x).filter((v) => typeof v === 'string' && /\d/.test(v) && coerceAmount(v) !== null).length
  }
  return n
}

function itemIssues(prefix: string, arr: unknown, item: z.ZodType, max: number): string[] {
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  arr.slice(0, max).forEach((x, i) => {
    const r = item.safeParse(x)
    if (!r.success) for (const iss of r.error.issues) out.push(`${prefix}.${i}${iss.path.length ? '.' + iss.path.join('.') : ''}:${iss.code}`)
  })
  return out.slice(0, 20)
}

export type ParsedAi = { result: AiInvoice | null; diag: AiDiagnostics | null }

/** Premier objet JSON d'une réponse (tolère ```json, balises <think>), avec diagnostic de forme. */
export function parseAiJsonDetailed(raw: string): ParsedAi {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return { result: null, diag: null }
  let obj: unknown
  try { obj = JSON.parse(cleaned.slice(start, end + 1)) } catch { return { result: null, diag: null } }
  if (!isObj(obj)) return { result: null, diag: null }
  const numericTypes = Object.fromEntries(NUMERIC_KEYS.map((k) => [k, typeOf(obj[k])]))
  const stringNumbers = countStringNumbers(obj)
  const ambiguousResolved = resolveAmbiguous(obj)
  const parsed = aiInvoiceSchema.safeParse(obj)
  if (!parsed.success) return { result: null, diag: null }
  const result = parsed.data as AiInvoice
  const nullKeys = Object.keys(aiInvoiceSchema.shape).filter((k) => (result as Record<string, unknown>)[k] == null)
  const issues = [...itemIssues('lines', obj.lines, lineSchema, 200), ...itemIssues('vat', obj.vat, vatSchema, 5)]
  const linesIn = Array.isArray(obj.lines) ? obj.lines.length : 0
  return { result, diag: { numericTypes, nullKeys, issues, linesIn, linesKept: result.lines?.length ?? 0, stringNumbers, ambiguousResolved } }
}

/** Premier objet JSON d'une réponse, validé (null si absent ou illisible). */
export function parseAiJson(raw: string): AiInvoice | null {
  return parseAiJsonDetailed(raw).result
}

/**
 * Réponse incomplète : ni TTC ni HT, et soit aucune ligne, soit l'extraction déterministe
 * avait trouvé ces totaux dans le texte (l'IA les a donc manqués).
 */
export function isIncomplete(r: AiInvoice | null, det?: InvoiceExtraction | null): boolean {
  if (!r) return true
  const noTotals = r.total == null && r.subtotal == null
  if (!noTotals) return false
  const noLines = !r.lines?.length
  const detHasTotals = !!det && (det.total.value !== null || det.subtotal.value !== null)
  return noLines || detHasTotals
}

/** Score de complétude (pour garder la meilleure de plusieurs réponses). */
export function completeness(r: AiInvoice | null): number {
  if (!r) return -1
  let s = 0
  if (r.total != null) s += 3
  if (r.subtotal != null) s += 3
  if (r.lines?.length) s += 3
  for (const k of ['supplierName', 'matriculeFiscal', 'invoiceNumber', 'date', 'fodec', 'vatTotal', 'stamp'] as const) if (r[k] != null) s += 1
  if (r.vat?.length) s += 1
  return s
}

/** Schéma de sortie structurée Gemini (sous-ensemble OpenAPI de generationConfig.responseSchema). */
const S = (type: string, extra: Record<string, unknown> = {}) => ({ type, nullable: true, ...extra })
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    documentType: S('STRING', { description: 'facture | bon_de_commande | devis | bon_de_livraison' }),
    supplierName: S('STRING'), matriculeFiscal: S('STRING'), invoiceNumber: S('STRING'),
    date: S('STRING', { description: 'YYYY-MM-DD' }),
    subtotal: S('NUMBER'), fodec: S('NUMBER'), vatTotal: S('NUMBER'), stamp: S('NUMBER'), total: S('NUMBER'),
    vat: S('ARRAY', { items: { type: 'OBJECT', properties: { rate: { type: 'NUMBER' }, base: S('NUMBER'), amount: { type: 'NUMBER' } }, required: ['rate', 'amount'] } }),
    lines: S('ARRAY', { items: { type: 'OBJECT', properties: { reference: S('STRING'), designation: { type: 'STRING' }, quantity: { type: 'NUMBER' }, unitPrice: { type: 'NUMBER' }, total: { type: 'NUMBER' } }, required: ['designation', 'quantity', 'unitPrice', 'total'] } }),
  },
}

export type PostResult = { ok: true; json: unknown } | { ok: false; status: number }

/** POST JSON vers un fournisseur IA (délai 25 s) ; seul le statut HTTP est journalisé, jamais le contenu. */
export async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<PostResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal })
    if (!res.ok) {
      // statut seulement : jamais le contenu
      console.warn(`[ai-invoice] fournisseur IA HTTP ${res.status}`)
      return { ok: false, status: res.status }
    }
    return { ok: true, json: await res.json() }
  } catch (e) {
    console.warn('[ai-invoice] fournisseur IA indisponible :', (e as Error)?.name)
    return { ok: false, status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

function splitDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
  return m ? { mime: m[1], data: m[2] } : null
}

export type AiCallOutcome =
  | { status: 'ok'; result: AiInvoice; diag: AiDiagnostics | null }
  | { status: 'invalid' }
  | { status: 'http_error'; httpStatus: number }

/** Compteur d'appels HTTP d'un fournisseur pour la requête en cours. */
export type CallBudget = { used: number; max: number }

const RETRY_HINT = `\nATTENTION : une réponse précédente était incomplète ou mal formée. Renseigne total, subtotal et lines s'ils figurent
sur la facture, avec des nombres JSON simples (ex. 7344.609), sans guillemets, sans espace ni séparateur de milliers.`

/** Un appel au fournisseur (+ éventuelle nouvelle tentative Gemini sans schéma si 400), dans la limite du budget. */
export async function callAiDetailed(p: AiProvider, text: string, image?: string | null, opts: { retry?: boolean; budget?: CallBudget } = {}): Promise<AiCallOutcome> {
  const budget = opts.budget ?? { used: 0, max: MAX_CALLS_PER_PROVIDER }
  if (budget.used >= budget.max) return { status: 'http_error', httpStatus: 0 }
  const userText = `${PROMPT}${opts.retry ? RETRY_HINT : ''}\n\nTexte OCR :\n"""\n${text.slice(0, 30_000)}\n"""`
  const img = image ? splitDataUrl(image) : null
  let out = ''
  if (p.name === 'gemini') {
    const parts: unknown[] = [{ text: userText }]
    if (img) parts.push({ inline_data: { mime_type: img.mime, data: img.data } })
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`
    const req = (schema: boolean) => ({
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(schema ? { responseSchema: GEMINI_RESPONSE_SCHEMA } : {}) },
    })
    budget.used++
    let r = await postJson(url, { 'x-goog-api-key': p.key }, req(true))
    // Schéma refusé par le modèle (400) : une seule nouvelle tentative en JSON libre (si le budget le permet), validé par zod de toute façon
    if (!r.ok && r.status === 400 && budget.used < budget.max) {
      budget.used++
      r = await postJson(url, { 'x-goog-api-key': p.key }, req(false))
    }
    if (!r.ok) return { status: 'http_error', httpStatus: r.status }
    const json = r.json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null
    out = json?.candidates?.[0]?.content?.parts?.map((x) => x.text ?? '').join('') ?? ''
  } else {
    const content: unknown[] = [{ type: 'text', text: userText }]
    if (img) content.push({ type: 'image_url', image_url: { url: image } })
    budget.used++
    const r = await postJson(
      'https://api.groq.com/openai/v1/chat/completions',
      { Authorization: `Bearer ${p.key}` },
      { model: p.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: img ? content : userText }] },
    )
    if (!r.ok) return { status: 'http_error', httpStatus: r.status }
    const json = r.json as { choices?: Array<{ message?: { content?: string } }> } | null
    out = json?.choices?.[0]?.message?.content ?? ''
  }
  const parsed = out ? parseAiJsonDetailed(out) : { result: null, diag: null }
  return parsed.result ? { status: 'ok', result: parsed.result, diag: parsed.diag } : { status: 'invalid' }
}

export async function callAi(p: AiProvider, text: string, image?: string | null): Promise<AiInvoice | null> {
  const r = await callAiDetailed(p, text, image)
  return r.status === 'ok' ? r.result : null
}

/** Codes d'avertissement renvoyés au client (jamais de contenu). */
export type AiWarning = 'ai:invalid_output' | 'ai:incomplete' | 'ai:retried' | 'ai:fallback' | 'ai:string_numbers' | 'ai:lines_dropped' | 'ai:ambiguous_amounts'

function logShape(provider: string, attempt: number, kind: 'invalid' | 'incomplete', diag: AiDiagnostics | null) {
  // forme seulement : types, clés nulles, chemins zod — jamais de valeur ni de texte de la facture
  console.warn(`[ai-invoice] réponse ${kind} (${provider}, essai ${attempt})`, JSON.stringify(diag ? {
    numericTypes: diag.numericTypes, nullKeys: diag.nullKeys, issues: diag.issues, linesIn: diag.linesIn, linesKept: diag.linesKept,
  } : { parse: 'failed' }))
}

export type AiExtractOutcome = { provider: AiProvider['name']; result: AiInvoice; warnings: AiWarning[] }

/**
 * Essaie chaque fournisseur (Gemini puis Groq). Une réponse illisible ou incomplète (voir isIncomplete,
 * comparée à l'extraction déterministe `det` si fournie) est relancée UNE fois chez le même fournisseur
 * (au plus MAX_CALLS_PER_PROVIDER appels HTTP chacun), puis le suivant est essayé.
 * Erreur HTTP / quota → fournisseur suivant. Renvoie la réponse la plus complète, ou null.
 */
export async function extractWithAi(providers: AiProvider[], text: string, image?: string | null, det?: InvoiceExtraction | null): Promise<AiExtractOutcome | null> {
  const warnings = new Set<AiWarning>()
  let best: { provider: AiProvider['name']; result: AiInvoice } | null = null
  const consider = (provider: AiProvider['name'], result: AiInvoice) => {
    if (!best || completeness(result) > completeness(best.result)) best = { provider, result }
  }
  for (const [i, p] of providers.entries()) {
    if (i > 0 && best) warnings.add('ai:fallback')
    const budget: CallBudget = { used: 0, max: MAX_CALLS_PER_PROVIDER }
    let attempt = 0
    while (budget.used < budget.max) {
      attempt++
      if (attempt > 1) warnings.add('ai:retried')
      const r = await callAiDetailed(p, text, image, { retry: attempt > 1, budget })
      if (r.status === 'http_error') break
      if (r.status === 'invalid') { warnings.add('ai:invalid_output'); logShape(p.name, attempt, 'invalid', null); continue }
      if (r.diag?.stringNumbers) warnings.add('ai:string_numbers')
      if (r.diag && r.diag.linesKept < r.diag.linesIn) warnings.add('ai:lines_dropped')
      if (r.diag?.ambiguousResolved) warnings.add('ai:ambiguous_amounts')
      consider(p.name, r.result)
      if (!isIncomplete(r.result, det)) {
        warnings.delete('ai:incomplete')
        return { provider: p.name, result: r.result, warnings: [...warnings] }
      }
      warnings.add('ai:incomplete')
      logShape(p.name, attempt, 'incomplete', r.diag)
    }
  }
  const b = best as { provider: AiProvider['name']; result: AiInvoice } | null
  return b ? { provider: b.provider, result: b.result, warnings: [...warnings] } : null
}
