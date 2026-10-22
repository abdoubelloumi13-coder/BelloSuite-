/**
 * POST /api/ai/dictate-quote — Speech-to-Devis : structure une dictée en brouillon de devis.
 * Corps : { transcript: string (≤ 5000 car.), locale?: 'fr' | 'en' | 'ar' }.
 * Le catalogue (produits actifs, clients actifs) est lu côté serveur, limité au tenant de la session.
 * Réponse : { provider: 'gemini' | 'groq' | 'local', result: DictatedQuote, aiWarnings?: string[] }.
 *  - IA configurée (GEMINI_API_KEY / GROQ_API_KEY) : Gemini puis Groq ; échec / quota / réponse vide → analyse locale.
 *  - Sans clé : analyse locale déterministe (lib/dictate-quote).
 * Rien n'est enregistré : le formulaire est seulement prérempli après confirmation. La dictée n'est jamais journalisée.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { prisma } from '@/lib/db'
import { enforceAiLimits } from '@/lib/security/ai-limits'
import { aiProviders } from '@/lib/ai-invoice'
import { dictateWithAi, MAX_CLIENTS_IN_PROMPT, MAX_PRODUCTS_IN_PROMPT } from '@/lib/ai-dictate'
import { MAX_TRANSCRIPT, parseDictationLocal, type Catalog } from '@/lib/dictate-quote'

export const runtime = 'nodejs'
export const maxDuration = 30

/** Dictées analysées par tenant et par heure (IA ou locale). */
const DICTATE_LIMIT = 40

const requestSchema = z.object({
  transcript: z.string().trim().min(1).max(MAX_TRANSCRIPT),
  locale: z.enum(['fr', 'en', 'ar']).optional(),
})

async function loadCatalog(tenantId: string): Promise<Catalog> {
  const [products, clients] = await Promise.all([
    prisma.product.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, code: true, salePrice: true, vatRate: true },
      orderBy: { name: 'asc' },
      take: MAX_PRODUCTS_IN_PROMPT,
    }),
    prisma.client.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: MAX_CLIENTS_IN_PROMPT,
    }),
  ])
  return {
    products: products.map((p) => ({ id: p.id, name: p.name, reference: p.code, unitPrice: Number(p.salePrice), vatRate: Number(p.vatRate) })),
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx

    const body = await req.json().catch(() => null)
    const data = parseBody(requestSchema, body)
    if (data instanceof NextResponse) return data

    const limited = await enforceAiLimits(req, ctx, 'ai-dictate-quote', DICTATE_LIMIT)
    if (limited) return limited

    const catalog = await loadCatalog(ctx.tenantId)
    const providers = aiProviders()
    if (providers.length) {
      const out = await dictateWithAi(providers, data.transcript, catalog, data.locale)
      if (out) {
        return NextResponse.json({ provider: out.provider, result: out.result, ...(out.warnings.length ? { aiWarnings: out.warnings } : {}) })
      }
      return NextResponse.json({ provider: 'local', result: parseDictationLocal(data.transcript, catalog), aiWarnings: ['ai:unavailable'] })
    }
    return NextResponse.json({ provider: 'local', result: parseDictationLocal(data.transcript, catalog) })
  } catch (err) {
    return handleApiError(err, 'POST ai dictate-quote')
  }
}
