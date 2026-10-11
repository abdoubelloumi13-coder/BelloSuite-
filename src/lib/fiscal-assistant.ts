/**
 * Assistant fiscal tunisien (RAG) — logique pure + orchestration testable.
 *
 * question → embedding (une fois) → recherche hybride (versions en vigueur d'abord, versions antérieures
 * seulement en complément et signalées) → prompt strict « réponds uniquement à partir des extraits, cite [n] »
 * → Gemini (repli Groq) → { answer, citations }.
 * Aucun contenu de question n'est journalisé (statuts HTTP / compteurs seulement).
 */
import { z } from 'zod'
import { aiProviders, type AiProvider } from './ai-invoice'
import { embedConfigFromEnv, type EmbedConfig, type FetchLike, type RawDb } from './fiscal-kb-ingest'
import { embedQuery, searchFiscalKb, type FiscalHit, type FiscalSearchOptions } from './fiscal-kb'

export type AssistantLang = 'fr' | 'ar' | 'en'

export const FISCAL_CODES = ['TVA', 'DET', 'IRPP_IS', 'LF2026', 'FODEC'] as const

export const assistantRequestSchema = z.object({
  question: z.string().trim().min(3).max(1500),
  codes: z.array(z.enum(FISCAL_CODES)).max(5).optional(),
})

export const searchRequestSchema = z.object({
  q: z.string().trim().min(2).max(500),
  codes: z.array(z.enum(FISCAL_CODES)).max(5).optional(),
  currentOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(30).optional(),
})

export interface AssistantCitation {
  n: number
  label: string
  code: string
  article: string | null
  version: string
  lang: string
  url: string
  outdated: boolean
  excerpt: string
}

export interface AssistantAnswer {
  answer: string
  /** 'ok' : réponse IA ; 'no_sources' : aucun extrait ; 'retrieval_only' : IA indisponible, extraits seuls. */
  status: 'ok' | 'no_sources' | 'retrieval_only'
  lang: AssistantLang
  provider: AiProvider['name'] | null
  citations: AssistantCitation[]
}

const ARABIC = /[\u0600-\u06FF]/g
const LATIN = /[A-Za-z\u00C0-\u017F]/g
const EN_WORDS = /\b(the|what|which|how|is|are|rate|tax|does|do|for|of|on|withholding|invoice|stamp|duty|can|should)\b/gi
const FR_WORDS = /\b(le|la|les|des|du|est|quel|quelle|quels|taux|pour|sur|une|un|facture|droit|retenue|à|au|aux|en)\b/gi

/** Langue de la question (heuristique sans dépendance) : arabe si l'alphabet arabe domine, sinon fr/en par mots-outils. */
export function detectLang(q: string): AssistantLang {
  const ar = (q.match(ARABIC) || []).length
  const lat = (q.match(LATIN) || []).length
  if (ar > 0 && ar >= lat * 0.5) return 'ar'
  const en = (q.match(EN_WORDS) || []).length
  const fr = (q.match(FR_WORDS) || []).length
  return en > fr ? 'en' : 'fr'
}

export const REFUSAL: Record<AssistantLang, string> = {
  fr: 'Je ne trouve pas de base dans les textes pour répondre à cette question.',
  en: "I can't find a basis in the texts to answer this question.",
  ar: 'لا أجد أساسًا في النصوص للإجابة عن هذا السؤال.',
}

export const DISCLAIMER: Record<AssistantLang, string> = {
  fr: 'ℹ️ Information générale tirée des textes officiels indexés : ne remplace pas l’avis d’un conseiller fiscal ou d’un expert-comptable. Vérifiez la version en vigueur.',
  en: 'ℹ️ General information drawn from the indexed official texts: not a substitute for advice from a tax adviser or chartered accountant. Check the version in force.',
  ar: 'ℹ️ معلومات عامة مستخرجة من النصوص الرسمية المفهرسة، ولا تغني عن استشارة مستشار جبائي أو خبير محاسب. تحقّق من النسخة السارية.',
}

const RETRIEVAL_ONLY_NOTE: Record<AssistantLang, string> = {
  fr: 'L’assistant IA est momentanément indisponible. Voici les passages des textes les plus pertinents :',
  en: 'The AI assistant is temporarily unavailable. Here are the most relevant passages from the texts:',
  ar: 'المساعد الذكي غير متاح حاليًا. إليك أكثر المقاطع صلة من النصوص:',
}

const LANG_NAME: Record<AssistantLang, string> = { fr: 'français', en: 'anglais (English)', ar: 'arabe (العربية)' }

/** Prompt système strict (exporté pour les tests). */
export function buildSystemPrompt(lang: AssistantLang): string {
  return `Tu es l'assistant fiscal de BelloSuite, ERP pour PME tunisiennes. Tu réponds à des questions sur la fiscalité tunisienne
UNIQUEMENT à partir des EXTRAITS numérotés [1], [2]… fournis dans le message (codes officiels : TVA, droits d'enregistrement et de timbre,
IRPP/IS, loi de finances 2026, FODEC). Règles impératives :
1. N'utilise AUCUNE connaissance extérieure aux extraits. N'invente jamais un taux, un montant, un seuil, une date ou un numéro d'article.
2. Chaque affirmation factuelle est suivie de sa source au format [n] (numéro de l'extrait), ex. « … au taux de 19 % [2]. ».
   N'utilise que des numéros d'extraits existants. Ne cite pas un extrait qui ne soutient pas l'affirmation.
3. Si les extraits ne permettent pas de répondre, réponds exactement : « ${REFUSAL[lang]} » puis, au plus, une phrase indiquant
   quel texte consulter. Si la réponse n'est que partielle, dis clairement ce qui n'est pas couvert.
4. Les extraits marqués [version antérieure — à vérifier] peuvent être périmés : signale-le explicitement si tu t'appuies dessus,
   et préfère toujours les extraits en vigueur (2026).
5. Les extraits en arabe font foi : tu peux les citer brièvement entre guillemets et les traduire fidèlement.
6. Réponds en ${LANG_NAME[lang]}, de façon concise et structurée (phrases courtes ou puces), sans préambule.
7. N'ajoute pas d'avertissement final : il est ajouté automatiquement.`
}

/** Message utilisateur : extraits numérotés + question. Les extraits sont tronqués pour tenir dans le budget. */
export function buildUserPrompt(question: string, hits: FiscalHit[], maxChars = 14_000): string {
  const per = Math.max(600, Math.floor(maxChars / Math.max(1, hits.length)))
  const blocks = hits.map((h, i) => {
    const c = h.citation
    const head = `[${i + 1}] ${c.label} | code=${c.code} | article=${c.article ?? '—'} | version=${c.version}${c.outdated ? ' | PÉRIMÉ' : ''}`
    const body = h.content.length > per ? `${h.content.slice(0, per)}…` : h.content
    return `${head}\n${body}`
  })
  return `EXTRAITS :\n\n${blocks.join('\n\n---\n\n')}\n\nQUESTION :\n${question}`
}

export function toCitations(hits: FiscalHit[], excerptChars = 700): AssistantCitation[] {
  return hits.map((h, i) => ({
    n: i + 1,
    label: h.citation.label,
    code: h.citation.code,
    article: h.citation.article,
    version: h.citation.version,
    lang: h.citation.lang,
    url: h.citation.url,
    outdated: h.citation.outdated,
    excerpt: h.content.length > excerptChars ? `${h.content.slice(0, excerptChars).trimEnd()}…` : h.content,
  }))
}

/** Numéros [n] cités dans la réponse (y compris « [1, 3] » et « [2][4] »), bornés aux extraits fournis. */
export function citedNumbers(answer: string, max: number): number[] {
  const out = new Set<number>()
  for (const m of answer.matchAll(/\[(\d+(?:\s*[,;،]\s*\d+)*)\]/g)) {
    for (const n of m[1].split(/[,;،]/)) {
      const v = Number(n.trim())
      if (Number.isInteger(v) && v >= 1 && v <= max) out.add(v)
    }
  }
  return Array.from(out).sort((a, b) => a - b)
}

/** Retire les références [n] qui ne correspondent à aucun extrait (hallucinations de numéros). */
export function stripUnknownRefs(answer: string, max: number): string {
  return answer.replace(/\[(\d+(?:\s*[,;،]\s*\d+)*)\]/g, (full, inner: string) => {
    const kept = inner.split(/[,;،]/).map((x) => Number(x.trim())).filter((v) => Number.isInteger(v) && v >= 1 && v <= max)
    return kept.length ? `[${kept.join(', ')}]` : ''
  })
}

export function isRefusal(answer: string, lang: AssistantLang): boolean {
  const head = REFUSAL[lang].slice(0, 30).toLowerCase()
  return answer.toLowerCase().includes(head)
}

/**
 * Récupération : versions en vigueur d'abord ; si moins de `minCurrent` extraits, complète avec des versions
 * antérieures (signalées `outdated`). Un seul embedding de requête.
 */
export async function retrieve(
  question: string,
  deps: { db: RawDb; embed?: EmbedConfig | null; fetchImpl?: FetchLike },
  opts: { limit?: number; codes?: string[]; minCurrent?: number } = {},
): Promise<{ hits: FiscalHit[]; mode: string }> {
  const limit = opts.limit ?? 8
  const embed = deps.embed === undefined ? embedConfigFromEnv() : deps.embed
  let queryVector: number[] | null = null
  if (embed) {
    try {
      queryVector = await embedQuery(question, embed, deps.fetchImpl)
    } catch {
      queryVector = null // quota / réseau : plein texte seul
    }
  }
  const base: FiscalSearchOptions = { limit, codes: opts.codes }
  const d = { db: deps.db, fetchImpl: deps.fetchImpl, embed: null, queryVector }
  const current = await searchFiscalKb(question, d, { ...base, outdated: 'exclude' })
  if (current.hits.length >= (opts.minCurrent ?? 3)) return { hits: current.hits, mode: current.mode }
  const all = await searchFiscalKb(question, d, { ...base, outdated: 'include' })
  const seen = new Set(current.hits.map((h) => h.id))
  const extra = all.hits.filter((h) => h.citation.outdated && !seen.has(h.id))
  return { hits: [...current.hits, ...extra].slice(0, limit), mode: all.mode }
}

type PostResult = { ok: true; json: unknown } | { ok: false; status: number }

async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs = 25_000): Promise<PostResult> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal })
    if (!res.ok) {
      console.warn(`[fiscal-assistant] fournisseur IA HTTP ${res.status}`)
      return { ok: false, status: res.status }
    }
    return { ok: true, json: await res.json() }
  } catch (e) {
    console.warn('[fiscal-assistant] fournisseur IA indisponible :', (e as Error)?.name)
    return { ok: false, status: 0 }
  } finally {
    clearTimeout(timer)
  }
}

/** Appel LLM (texte libre). Renvoie null en cas d'échec — jamais d'exception, jamais de contenu journalisé. */
export async function callLlm(p: AiProvider, system: string, user: string, fetchImpl: FetchLike): Promise<string | null> {
  if (p.name === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(p.model)}:generateContent`
    const r = await postJson(fetchImpl, url, { 'x-goog-api-key': p.key }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1200 },
    })
    if (!r.ok) return null
    const json = r.json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null
    const out = json?.candidates?.[0]?.content?.parts?.map((x) => x.text ?? '').join('').trim()
    return out || null
  }
  const r = await postJson(fetchImpl, 'https://api.groq.com/openai/v1/chat/completions', { Authorization: `Bearer ${p.key}` }, {
    model: p.model,
    temperature: 0.1,
    max_tokens: 1200,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  })
  if (!r.ok) return null
  const json = r.json as { choices?: Array<{ message?: { content?: string } }> } | null
  // Certains modèles Groq renvoient un bloc de raisonnement <think>…</think> : on le retire.
  const out = json?.choices?.[0]?.message?.content?.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  return out || null
}

export interface AskDeps {
  db: RawDb
  providers?: AiProvider[]
  embed?: EmbedConfig | null
  fetchImpl?: FetchLike
  /** Injection pour les tests. */
  retrieveImpl?: typeof retrieve
}

/** Orchestration complète. Ne lève pas pour les erreurs IA (repli « extraits seuls »). */
export async function askFiscalAssistant(question: string, deps: AskDeps, opts: { codes?: string[] } = {}): Promise<AssistantAnswer> {
  const lang = detectLang(question)
  const fetchImpl: FetchLike = deps.fetchImpl || ((i, init) => fetch(i, init))
  const { hits } = await (deps.retrieveImpl || retrieve)(question, { db: deps.db, embed: deps.embed, fetchImpl }, { limit: 8, codes: opts.codes })
  if (!hits.length) {
    return { answer: `${REFUSAL[lang]}\n\n${DISCLAIMER[lang]}`, status: 'no_sources', lang, provider: null, citations: [] }
  }
  const all = toCitations(hits)
  const providers = deps.providers ?? aiProviders()
  const system = buildSystemPrompt(lang)
  const user = buildUserPrompt(question, hits)
  for (const p of providers) {
    const raw = await callLlm(p, system, user, fetchImpl)
    if (!raw) continue
    const text = stripUnknownRefs(raw, hits.length)
    const nums = citedNumbers(text, hits.length)
    const refused = isRefusal(text, lang)
    // Une réponse non refusée mais sans aucune citation viole la règle 2 : on la traite comme un refus prudent.
    if (!refused && nums.length === 0) {
      return { answer: `${REFUSAL[lang]}\n\n${DISCLAIMER[lang]}`, status: 'ok', lang, provider: p.name, citations: all.slice(0, 3) }
    }
    const citations = nums.length ? all.filter((c) => nums.includes(c.n)) : all.slice(0, 3)
    return { answer: `${text}\n\n${DISCLAIMER[lang]}`, status: 'ok', lang, provider: p.name, citations }
  }
  return { answer: `${RETRIEVAL_ONLY_NOTE[lang]}\n\n${DISCLAIMER[lang]}`, status: 'retrieval_only', lang, provider: null, citations: all }
}
