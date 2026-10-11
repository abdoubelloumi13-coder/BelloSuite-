/**
 * Speech-to-Devis — structuration IA OPTIONNELLE d'une dictée (côté serveur).
 * Mêmes fournisseurs gratuits que l'extraction de factures (voir ai-invoice.ts) : Gemini (GEMINI_API_KEY,
 * GEMINI_MODEL, défaut gemini-3.5-flash-lite) puis Groq en repli (GROQ_API_KEY, GROQ_MODEL).
 * La réponse est validée (zod tolérant + coercition des montants TN), puis ramenée au catalogue du tenant
 * (`finalizeDictation`) : un id inconnu est ignoré. La dictée n'est jamais journalisée ni stockée.
 */
import { z } from 'zod'
import { coerceAmount, postJson, type AiProvider } from '@/lib/ai-invoice'
import { finalizeDictation, type Catalog, type DictatedQuote } from '@/lib/dictate-quote'

/** Plafonds du catalogue envoyé au modèle (taille du prompt maîtrisée). */
export const MAX_PRODUCTS_IN_PROMPT = 300
export const MAX_CLIENTS_IN_PROMPT = 300

const optNum = z.unknown().transform((v) => coerceAmount(v)).catch(null)
const optStr = (max: number) => z.unknown().transform((v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)).catch(null)

const lineSchema = z.object({
  productId: optStr(64),
  description: optStr(300),
  quantity: optNum,
  unitPrice: optNum,
  discount: optNum,
  vatRate: optNum,
})

export const aiDictationSchema = z.object({
  clientId: optStr(64),
  clientName: optStr(120),
  lines: z.unknown().transform((v) => {
    if (!Array.isArray(v)) return []
    const out: Array<z.infer<typeof lineSchema>> = []
    for (const x of v.slice(0, 100)) { const r = lineSchema.safeParse(x); if (r.success) out.push(r.data) }
    return out
  }),
  notes: optStr(500),
  validityDays: optNum,
})

const S = (type: string, extra: Record<string, unknown> = {}) => ({ type, nullable: true, ...extra })
export const GEMINI_DICTATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    clientId: S('STRING'), clientName: S('STRING'), notes: S('STRING'), validityDays: S('NUMBER'),
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { productId: S('STRING'), description: { type: 'STRING' }, quantity: { type: 'NUMBER' }, unitPrice: S('NUMBER'), discount: S('NUMBER'), vatRate: S('NUMBER') },
        required: ['description', 'quantity'],
      },
    },
  },
  required: ['lines'],
}

const clean = (s: string) => s.replace(/[|\n\r]+/g, ' ').trim()

/** Prompt : consignes + catalogue compact (id|nom|réf|PU HT|TVA ; id|nom) + dictée. */
export function buildDictationPrompt(transcript: string, catalog: Catalog, locale = 'fr'): string {
  const products = catalog.products.slice(0, MAX_PRODUCTS_IN_PROMPT)
    .map((p) => [p.id, clean(p.name), clean(p.reference ?? ''), p.unitPrice ?? '', p.vatRate ?? ''].join('|')).join('\n')
  const clients = catalog.clients.slice(0, MAX_CLIENTS_IN_PROMPT).map((c) => `${c.id}|${clean(c.name)}`).join('\n')
  return `Tu transformes une DICTÉE VOCALE (langue d'interface : ${locale} ; français, arabe tunisien / derja ou anglais,
transcription automatique éventuellement bruitée) en brouillon de devis pour une PME tunisienne.
Réponds UNIQUEMENT avec un objet JSON de la forme :
{"clientId":string|null,"clientName":string|null,"lines":[{"productId":string|null,"description":string,"quantity":number,
"unitPrice":number|null,"discount":number|null,"vatRate":number|null}],"notes":string|null,"validityDays":number|null}
Règles : clientId / productId = un id EXACT des listes ci-dessous quand le client / produit dicté y correspond (orthographe
approximative tolérée), sinon null (clientName / description gardent alors le libellé dicté) ; quantity : nombres en lettres
convertis (« dix » → 10, « زوز » → 2) ; unitPrice = prix unitaire HT en dinars SEULEMENT s'il est dicté (« à 12,5 dinars » → 12.5 ;
« 12 dinars 500 » → 12.5), sinon null (le prix du catalogue sera utilisé) ; discount = remise en % si dictée ; vatRate = 0, 7, 13
ou 19 seulement si dictée ; validityDays = durée de validité du devis si dictée ; notes = remarque explicitement dictée, sinon null.
Nombres JSON simples (point décimal, sans devise). N'invente aucune ligne.

PRODUITS (id|nom|référence|PU HT|TVA %) :
${products || '(aucun)'}

CLIENTS (id|nom) :
${clients || '(aucun)'}

DICTÉE :
"""
${transcript}
"""`
}

/** Premier objet JSON d'une réponse (```json, <think> tolérés), validé ; null sinon. */
export function parseDictationJson(raw: string): DictatedQuote | null {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: unknown
  try { obj = JSON.parse(cleaned.slice(start, end + 1)) } catch { return null }
  const r = aiDictationSchema.safeParse(obj)
  if (!r.success) return null
  return {
    clientId: r.data.clientId,
    clientName: r.data.clientName,
    notes: r.data.notes,
    validityDays: r.data.validityDays,
    lines: r.data.lines
      .filter((l) => l.quantity !== null && (l.description || l.productId))
      .map((l) => ({ productId: l.productId, description: l.description ?? '', quantity: l.quantity as number, unitPrice: l.unitPrice, discount: l.discount, vatRate: l.vatRate })),
  }
}

async function callProvider(p: AiProvider, prompt: string): Promise<DictatedQuote | null | 'http_error'> {
  let out = ''
  if (p.name === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`
    const body = (schema: boolean) => ({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(schema ? { responseSchema: GEMINI_DICTATION_SCHEMA } : {}) },
    })
    let r = await postJson(url, { 'x-goog-api-key': p.key }, body(true))
    // schéma refusé (400) : une seule nouvelle tentative en JSON libre
    if (!r.ok && r.status === 400) r = await postJson(url, { 'x-goog-api-key': p.key }, body(false))
    if (!r.ok) return 'http_error'
    const json = r.json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null
    out = json?.candidates?.[0]?.content?.parts?.map((x) => x.text ?? '').join('') ?? ''
  } else {
    const r = await postJson('https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${p.key}` },
      { model: p.model, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] })
    if (!r.ok) return 'http_error'
    const json = r.json as { choices?: Array<{ message?: { content?: string } }> } | null
    out = json?.choices?.[0]?.message?.content ?? ''
  }
  return out ? parseDictationJson(out) : null
}

export type DictationAiOutcome = { provider: AiProvider['name']; result: DictatedQuote; warnings: string[] }

/**
 * Essaie Gemini puis Groq (un appel chacun, + nouvelle tentative Gemini sans schéma si 400).
 * Réponse illisible ou sans ligne → fournisseur suivant. Renvoie null si aucun n'a abouti (l'appelant
 * bascule alors sur l'analyse locale). Avertissements = codes seulement, jamais de contenu.
 */
export async function dictateWithAi(providers: AiProvider[], transcript: string, catalog: Catalog, locale?: string): Promise<DictationAiOutcome | null> {
  const prompt = buildDictationPrompt(transcript, catalog, locale)
  const warnings: string[] = []
  for (const [i, p] of providers.entries()) {
    if (i > 0) warnings.push('ai:fallback')
    const r = await callProvider(p, prompt)
    if (r === 'http_error') continue
    if (!r) { warnings.push('ai:invalid_output'); continue }
    const result = finalizeDictation(r, catalog)
    if (!result.lines.length) { warnings.push('ai:empty'); continue }
    return { provider: p.name, result, warnings: [...new Set(warnings)] }
  }
  return null
}
