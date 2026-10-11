/**
 * Base de connaissances fiscale tunisienne — recherche hybride (RAG).
 *
 * - Vectorielle (pgvector, cosinus) si une clé Gemini est disponible ET que des embeddings existent ;
 * - plein texte (tsvector 'french' / 'arabic') toujours, en repli et en complément ;
 * - fusion par Reciprocal Rank Fusion (RRF), versions périmées pénalisées (ou exclues) ;
 * - chaque résultat porte sa citation (texte, article, version, URL officielle).
 * Table globale `fiscal_chunks` (migration 20261010100000_fiscal_kb.sql), lue via SQL brut.
 */
import { embedConfigFromEnv, embedTexts, toVectorLiteral, type EmbedConfig, type FetchLike, type RawDb } from './fiscal-kb-ingest'

export type FiscalCode = 'IRPP_IS' | 'TVA' | 'DET' | 'LF2026' | 'FODEC' | (string & {})

export const FISCAL_CODE_LABELS: Record<string, string> = {
  IRPP_IS: "Code de l'IRPP et de l'IS",
  TVA: 'Code de la TVA',
  DET: "Code des droits d'enregistrement et de timbre",
  LF2026: 'Loi de finances 2026 (loi n° 2025-17)',
  FODEC: 'FODEC — Note commune n° 13/2012',
}

export interface FiscalChunkRow {
  id: string
  code: string
  article: string | null
  section: string | null
  title: string
  version: string
  lang: string
  source_url: string
  outdated: boolean
  part: number
  parts: number
  content: string
  score: number
}

export interface FiscalCitation {
  label: string
  code: string
  article: string | null
  version: string
  lang: string
  url: string
  outdated: boolean
}

export interface FiscalHit {
  id: string
  content: string
  section: string | null
  score: number
  matchedBy: Array<'vector' | 'fulltext'>
  citation: FiscalCitation
}

export interface FiscalSearchOptions {
  limit?: number
  codes?: string[]
  lang?: 'fr' | 'ar'
  /** 'penalize' (défaut) : gardées mais rétrogradées ; 'exclude' : écartées ; 'include' : traitées à égalité. */
  outdated?: 'penalize' | 'exclude' | 'include'
}

export interface FiscalSearchDeps {
  db: RawDb
  fetchImpl?: FetchLike
  /** null = pas de recherche vectorielle. Par défaut : GEMINI_API_KEY de l'environnement. */
  embed?: EmbedConfig | null
  /** Vecteur de requête déjà calculé (évite un second appel d'embedding pour la même question). */
  queryVector?: number[] | null
}

export interface FiscalSearchResult {
  mode: 'hybrid' | 'fulltext' | 'vector'
  hits: FiscalHit[]
}

const RRF_K = 60
const OUTDATED_PENALTY = 0.5

/** Termes de la requête pour un tsquery « OU » (rappel), le rang ts_rank favorise les chunks qui en couvrent le plus. */
export function toOrQuery(q: string): string {
  const words = q
    .normalize('NFC')
    .replace(/[\u064B-\u0652\u0640]/g, '') // harakat / tatweel
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 || /\d/.test(w))
  return Array.from(new Set(words)).slice(0, 24).join(' or ')
}

export function citationFor(r: Pick<FiscalChunkRow, 'code' | 'article' | 'version' | 'lang' | 'source_url' | 'outdated' | 'part' | 'parts'>): FiscalCitation {
  const base = FISCAL_CODE_LABELS[r.code] || r.code
  const art = r.article ? (r.lang === 'ar' ? `, الفصل ${r.article}` : `, art. ${r.article}`) : ''
  const part = r.parts > 1 ? ` (partie ${r.part}/${r.parts})` : ''
  const ver = r.code === 'LF2026' ? '' : ` ${r.version}`
  const flags = `${r.lang === 'ar' ? ' [texte arabe]' : ''}${r.outdated ? ' [version antérieure — à vérifier]' : ''}`
  return {
    label: `${base}${ver}${art}${part}${flags}`,
    code: r.code,
    article: r.article,
    version: r.version,
    lang: r.lang,
    url: r.source_url,
    outdated: r.outdated,
  }
}

function filters(opts: FiscalSearchOptions, params: unknown[]): string {
  const where: string[] = []
  if (opts.codes?.length) {
    params.push(opts.codes)
    where.push(`code = ANY($${params.length}::text[])`)
  }
  if (opts.lang) {
    params.push(opts.lang)
    where.push(`lang = $${params.length}`)
  }
  if (opts.outdated === 'exclude') where.push('NOT outdated')
  return where.length ? ` AND ${where.join(' AND ')}` : ''
}

const COLS = 'id, code, article, section, title, version, lang, source_url, outdated, part, parts, content'

export async function fullTextSearch(db: RawDb, query: string, opts: FiscalSearchOptions = {}, k = 20): Promise<FiscalChunkRow[]> {
  const orq = toOrQuery(query)
  if (!orq) return []
  // $1 = requête « OU » (rappel), $2 = requête brute (tous les termes) : les chunks couvrant
  // tous les termes passent devant, puis ts_rank_cd normalisé par la longueur (1|4).
  const params: unknown[] = [orq, query]
  const where = filters(opts, params)
  params.push(k)
  return db.$queryRawUnsafe<FiscalChunkRow[]>(
    `SELECT ${COLS}, ts_rank_cd(tsv, s.q, 1|4) + CASE WHEN tsv @@ s.qa THEN 1 ELSE 0 END AS score
       FROM public.fiscal_chunks,
            (SELECT websearch_to_tsquery('french', $1) || websearch_to_tsquery('arabic', $1) AS q,
                    websearch_to_tsquery('french', $2) || websearch_to_tsquery('arabic', $2) AS qa) AS s
      WHERE tsv @@ s.q${where}
      ORDER BY score DESC
      LIMIT $${params.length}`,
    ...params,
  )
}

export async function vectorSearch(db: RawDb, embedding: number[], opts: FiscalSearchOptions = {}, k = 20): Promise<FiscalChunkRow[]> {
  const params: unknown[] = [toVectorLiteral(embedding)]
  const where = filters(opts, params)
  params.push(k)
  return db.$queryRawUnsafe<FiscalChunkRow[]>(
    `SELECT ${COLS}, 1 - (embedding <=> $1::extensions.vector) AS score
       FROM public.fiscal_chunks
      WHERE embedding IS NOT NULL${where}
      ORDER BY embedding <=> $1::extensions.vector
      LIMIT $${params.length}`,
    ...params,
  )
}

/** Fusion RRF de listes classées (pure, testable). */
export function mergeRrf(
  lists: Array<{ source: 'vector' | 'fulltext'; rows: FiscalChunkRow[] }>,
  opts: Pick<FiscalSearchOptions, 'outdated' | 'limit'> = {},
): FiscalHit[] {
  const acc = new Map<string, { row: FiscalChunkRow; score: number; matchedBy: Set<'vector' | 'fulltext'> }>()
  for (const { source, rows } of lists) {
    rows.forEach((row, rank) => {
      const cur = acc.get(row.id) ?? { row, score: 0, matchedBy: new Set() }
      cur.score += 1 / (RRF_K + rank + 1)
      cur.matchedBy.add(source)
      acc.set(row.id, cur)
    })
  }
  const mode = opts.outdated ?? 'penalize'
  return Array.from(acc.values())
    .filter((x) => !(mode === 'exclude' && x.row.outdated))
    .map((x) => ({ ...x, score: mode === 'penalize' && x.row.outdated ? x.score * OUTDATED_PENALTY : x.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 8)
    .map(({ row, score, matchedBy }) => ({
      id: row.id,
      content: row.content,
      section: row.section,
      score: Number(score.toFixed(6)),
      matchedBy: Array.from(matchedBy),
      citation: citationFor(row),
    }))
}

/** Embedding d'une requête (tâche RETRIEVAL_QUERY), 1 nouvelle tentative max. */
export async function embedQuery(q: string, cfg: EmbedConfig, fetchImpl?: FetchLike): Promise<number[]> {
  const [vec] = await embedTexts([q.trim().slice(0, 2000)], cfg, { task: 'RETRIEVAL_QUERY', fetchImpl, retries: 1, backoffMs: 500 })
  return vec
}

async function hasEmbeddings(db: RawDb): Promise<boolean> {
  const r = await db.$queryRawUnsafe<Array<{ ok: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM public.fiscal_chunks WHERE embedding IS NOT NULL) AS ok`,
  )
  return Boolean(r[0]?.ok)
}

/**
 * Recherche hybride. Ne lève pas si l'embedding échoue (quota, réseau) : repli plein texte.
 */
export async function searchFiscalKb(query: string, deps: FiscalSearchDeps, opts: FiscalSearchOptions = {}): Promise<FiscalSearchResult> {
  const q = query.trim().slice(0, 2000)
  if (!q) return { mode: 'fulltext', hits: [] }
  const limit = Math.max(1, Math.min(opts.limit ?? 8, 30))
  const k = Math.max(limit * 3, 15)
  const embedCfg = deps.embed === undefined ? embedConfigFromEnv() : deps.embed

  const ftPromise = fullTextSearch(deps.db, q, opts, k)
  let vecRows: FiscalChunkRow[] = []
  if ((deps.queryVector?.length || embedCfg) && (await hasEmbeddings(deps.db))) {
    try {
      const vec = deps.queryVector?.length ? deps.queryVector : (await embedQuery(q, embedCfg as EmbedConfig, deps.fetchImpl))
      vecRows = await vectorSearch(deps.db, vec, opts, k)
    } catch {
      vecRows = []
    }
  }
  const ftRows = await ftPromise
  const hits = mergeRrf(
    [
      { source: 'vector', rows: vecRows },
      { source: 'fulltext', rows: ftRows },
    ],
    { outdated: opts.outdated, limit },
  )
  const mode = vecRows.length && ftRows.length ? 'hybrid' : vecRows.length ? 'vector' : 'fulltext'
  return { mode, hits }
}

/** Bloc de contexte prêt pour un prompt LLM, avec numéros de citation [1], [2]... */
export function formatContext(hits: FiscalHit[], maxChars = 12_000): string {
  const out: string[] = []
  let used = 0
  hits.forEach((h, i) => {
    const block = `[${i + 1}] ${h.citation.label}\nSource : ${h.citation.url}\n${h.content}`
    if (used + block.length > maxChars) return
    used += block.length
    out.push(block)
  })
  return out.join('\n\n---\n\n')
}
