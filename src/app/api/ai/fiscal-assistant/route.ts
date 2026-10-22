/**
 * POST /api/ai/fiscal-assistant — assistant fiscal tunisien (RAG sur les textes officiels indexés).
 * Corps : { question: string (fr/ar/en, 3–1500 car.), codes?: ('TVA'|'DET'|'IRPP_IS'|'LF2026'|'FODEC')[] }.
 * Réponse : { answer, status: 'ok'|'no_sources'|'retrieval_only', lang, provider, citations[{ n, label, code, article, version, lang, url, outdated, excerpt }] }.
 * Session + tenant obligatoires ; 20 questions / heure / tenant. Le contenu des questions n'est jamais journalisé.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { enforceAiLimits } from '@/lib/security/ai-limits'
import { askFiscalAssistant, assistantRequestSchema } from '@/lib/fiscal-assistant'

export const runtime = 'nodejs'
export const maxDuration = 45

const FISCAL_ASSISTANT_LIMIT = 20

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx

    const body = await req.json().catch(() => null)
    const data = parseBody(assistantRequestSchema, body)
    if (data instanceof NextResponse) return data

    const limited = await enforceAiLimits(req, ctx, 'ai-fiscal-assistant', FISCAL_ASSISTANT_LIMIT)
    if (limited) return limited

    const out = await askFiscalAssistant(data.question, { db: prisma }, { codes: data.codes })
    return NextResponse.json(out)
  } catch (err) {
    return handleApiError(err, 'POST ai fiscal-assistant')
  }
}
