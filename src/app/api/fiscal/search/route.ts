/**
 * POST /api/fiscal/search — recherche sémantique / plein texte dans les textes fiscaux indexés (sans IA générative).
 * Corps : { q: string, codes?: string[], currentOnly?: boolean, limit?: number (≤ 30, défaut 15) }.
 * Réponse : { mode, results[{ id, score, matchedBy, section, snippet, citation }] }.
 * Session + tenant obligatoires ; 120 recherches / heure / tenant. La requête n'est jamais journalisée.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { enforceAiLimits } from '@/lib/security/ai-limits'
import { searchFiscalKb } from '@/lib/fiscal-kb'
import { searchRequestSchema } from '@/lib/fiscal-assistant'
import { snippetFor } from '@/lib/fiscal-search-utils'

export const runtime = 'nodejs'
export const maxDuration = 20

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx

    const body = await req.json().catch(() => null)
    const data = parseBody(searchRequestSchema, body)
    if (data instanceof NextResponse) return data

    const limited = await enforceAiLimits(req, ctx, 'fiscal-search', 120)
    if (limited) return limited

    const r = await searchFiscalKb(data.q, { db: prisma }, {
      limit: data.limit ?? 15,
      codes: data.codes,
      outdated: data.currentOnly ? 'exclude' : 'penalize',
    })
    return NextResponse.json({
      mode: r.mode,
      results: r.hits.map((h) => ({
        id: h.id,
        score: h.score,
        matchedBy: h.matchedBy,
        section: h.section,
        snippet: snippetFor(h.content, data.q),
        content: h.content,
        citation: h.citation,
      })),
    })
  } catch (err) {
    return handleApiError(err, 'POST fiscal search')
  }
}
