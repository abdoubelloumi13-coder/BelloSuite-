/**
 * POST /api/ai/extract-invoice — affinage IA optionnel d'une facture fournisseur (« zéro saisie »).
 * Corps : { text: string (texte OCR / PDF), image?: data URL (image ≤ ~3 Mo) }.
 * Réponse : { available: false } sans clé (GEMINI_API_KEY / GROQ_API_KEY) — l'UI garde l'extraction déterministe ;
 *           { available: true, provider, result: AiInvoice | null, aiWarnings?: string[] } sinon
 *           (aiWarnings : codes seulement, ex. « ai:retried », « ai:string_numbers » — jamais de contenu).
 * Réponse IA incomplète → une relance chez le même fournisseur (≤ 2 appels Gemini), puis Groq ; une seule unité de quota.
 * Tenant depuis la session, limite par tenant, rien n'est stocké ni journalisé (ni texte ni image).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { enforceAiLimits } from '@/lib/security/ai-limits'
import { aiProviders, extractWithAi, extractRequestSchema } from '@/lib/ai-invoice'
import { extractInvoice } from '@/lib/invoice-extract'

export const runtime = 'nodejs'
export const maxDuration = 30

/** 5 Mo de fichier max côté client ; corps JSON (base64) plafonné ici. */
const MAX_BODY_BYTES = 5 * 1024 * 1024

export async function POST(req: NextRequest) {
  try {
    const ctx = await getApiContext(req)
    if (ctx instanceof NextResponse) return ctx

    const providers = aiProviders()
    if (!providers.length) return NextResponse.json({ available: false })

    const len = Number(req.headers.get('content-length') ?? 0)
    if (len > MAX_BODY_BYTES) return NextResponse.json({ error: 'Fichier trop volumineux (5 Mo max).' }, { status: 413 })

    const limited = await enforceAiLimits(req, ctx, 'ai-extract-invoice', 30)
    if (limited) return limited

    let body: unknown
    try {
      const raw = await req.text()
      if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'Fichier trop volumineux (5 Mo max).' }, { status: 413 })
      body = JSON.parse(raw)
    } catch {
      return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 })
    }
    const data = parseBody(extractRequestSchema, body)
    if (data instanceof NextResponse) return data
    if (!data.text.trim() && !data.image) return NextResponse.json({ available: true, provider: null, result: null })

    // Erreur / quota / réponse invalide de tous les fournisseurs → result null : l'UI garde l'extraction déterministe
    // Extraction déterministe (pure, rien de journalisé) : sert à juger si la réponse IA est incomplète
    const det = data.text.trim() ? extractInvoice(data.text) : null
    const out = await extractWithAi(providers, data.text, data.image ?? null, det)
    return NextResponse.json({
      available: true, provider: out?.provider ?? null, result: out?.result ?? null,
      ...(out?.warnings.length ? { aiWarnings: out.warnings } : {}),
    })
  } catch (err) {
    return handleApiError(err, 'POST ai extract-invoice')
  }
}
