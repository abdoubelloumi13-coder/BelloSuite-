import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { enforceAiLimits } from '@/lib/security/ai-limits'
import { embedTexts, MAX_EMBED_BATCH } from '@/lib/fiscal-kb-ingest'

/**
 * POST /api/scan/search-semantic
 * Recherche sémantique via embeddings (Gemini) sur les documents scannés
 * Corps : { query (≤ 500 car.), limit? (1–50), threshold? (0–1) }
 *
 * SÉCURITÉ / COÛT (audit E7) : limite de débit par entreprise et par utilisateur (plafonnée en démo),
 * au plus SEMANTIC_MAX_DOCS documents × SEMANTIC_DOC_CHARS caractères envoyés à Gemini par requête,
 * clé API dans l'en-tête x-goog-api-key (jamais dans l'URL), endpoint batchEmbedContents.
 */
const SEMANTIC_MAX_DOCS = 200
const SEMANTIC_DOC_CHARS = 2000
const SEMANTIC_LIMIT_PER_HOUR = 30

const bodySchema = z.object({
  query: z.string().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  threshold: z.coerce.number().min(0).max(1).default(0.65),
})
export async function POST(req: Request) {
  const auth = await requireTenant(req)
  if (auth instanceof NextResponse) return auth

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides' }, { status: 400 })
    const { query, limit, threshold } = parsed.data
    if (!query.trim()) return NextResponse.json({ results: [] })

    const limited = await enforceAiLimits(req, auth, 'scan-search-semantic', SEMANTIC_LIMIT_PER_HOUR)
    if (limited) return limited

    // 1. Récupérer les documents du tenant
    const docs = await prisma.scannedDocument.findMany({
      where: { tenantId: auth.tenantId },
      select: {
        id: true,
        fileName: true,
        fileType: true,
        documentKind: true,
        supplierName: true,
        supplierMf: true,
        reference: true,
        date: true,
        totalAmount: true,
        currency: true,
        extractedText: true,
      },
      orderBy: { createdAt: 'desc' },
      take: SEMANTIC_MAX_DOCS, // borne du coût d'embedding
    })

    if (!docs.length) return NextResponse.json({ results: [] })

    // 2. Appel Gemini embeddings
    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) {
      // Fallback : recherche textuelle simple
      return fallbackTextSearch(docs, query, limit)
    }

    // Préparer les textes pour embedding
    const texts = docs.map(d => `${d.fileName}\n${d.supplierName || ''}\n${d.reference || ''}\n${d.extractedText?.slice(0, SEMANTIC_DOC_CHARS) || ''}`)

    // Appel batch embedding (max 100 par appel)
    const embeddings = await getEmbeddings(geminiKey, [query, ...texts])
    if (!embeddings || embeddings.length !== texts.length + 1) {
      return fallbackTextSearch(docs, query, limit)
    }

    const queryVec = embeddings[0]
    const docVecs = embeddings.slice(1)

    // 3. Calcul similarité cosinus
    const results = docs.map((doc, i) => ({
      doc,
      similarity: cosineSimilarity(queryVec, docVecs[i]),
    }))
      .filter(r => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit)
      .map(r => ({
        ...r.doc,
        snippet: r.doc.extractedText?.slice(0, 150) + '…',
        similarity: Math.round(r.similarity * 100) / 100,
      }))

    return NextResponse.json({ results })
  } catch (e) {
    console.error('[scan] semantic search error', e)
    return fallbackTextSearch([], '', 0)
  }
}

async function getEmbeddings(apiKey: string, texts: string[]): Promise<number[][] | null> {
  // batchEmbedContents (format requests[]) + clé dans l'en-tête — via le client partagé de la base fiscale
  try {
    const [query, ...docs] = texts
    const [qv] = await embedTexts([query], { apiKey }, { task: 'RETRIEVAL_QUERY', retries: 1 })
    const allVecs: number[][] = [qv]
    for (let i = 0; i < docs.length; i += MAX_EMBED_BATCH) {
      allVecs.push(...await embedTexts(docs.slice(i, i + MAX_EMBED_BATCH), { apiKey }, { task: 'RETRIEVAL_DOCUMENT', retries: 1 }))
    }
    return allVecs
  } catch (e) {
    console.warn('[scan] embeddings indisponibles', (e as Error)?.message)
    return null
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function fallbackTextSearch(docs: any[], query: string, limit: number) {
  const q = query.toLowerCase()
  const scored = docs
    .map(doc => {
      const text = `${doc.fileName} ${doc.supplierName || ''} ${doc.reference || ''} ${doc.extractedText || ''}`.toLowerCase()
      const idx = text.indexOf(q)
      let score = 0
      if (idx >= 0) {
        score = 1 / (1 + idx / 100) // plus tôt = plus pertinent
        if (doc.reference?.toLowerCase().includes(q)) score += 0.5
        if (doc.supplierName?.toLowerCase().includes(q)) score += 0.3
      }
      return { doc, score }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(r => ({
      ...r.doc,
      snippet: r.doc.extractedText?.slice(0, 150) + '…',
      similarity: Math.round(r.score * 100) / 100,
    }))
  return NextResponse.json({ results: scored, fallback: true })
}