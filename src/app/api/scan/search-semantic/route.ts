import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * POST /api/scan/search-semantic
 * Recherche sémantique via embeddings (Gemini) sur les documents scannés
 * Corps : { query, limit?, threshold? }
 */
export async function POST(req: Request) {
  const auth = await requireTenant(req)
  if (auth instanceof NextResponse) return auth

  try {
    const { query, limit = 10, threshold = 0.65 } = await req.json()
    if (!query?.trim()) return NextResponse.json({ results: [] })

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
      take: 500, // limiter pour l'embedding
    })

    if (!docs.length) return NextResponse.json({ results: [] })

    // 2. Appel Gemini embeddings
    const geminiKey = process.env.GEMINI_API_KEY
    if (!geminiKey) {
      // Fallback : recherche textuelle simple
      return fallbackTextSearch(docs, query, limit)
    }

    // Préparer les textes pour embedding
    const texts = docs.map(d => `${d.fileName}\n${d.supplierName || ''}\n${d.reference || ''}\n${d.extractedText?.slice(0, 8000) || ''}`)

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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`

  try {
    // Appels par batch de 100
    const allVecs: number[][] = []
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100)
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: batch.map(t => ({
            model: 'models/embedding-001',
            content: { parts: [{ text: t.slice(0, 8000) }] },
          })),
        }),
      })
      if (!res.ok) return null
      const data = await res.json()
      const vecs = data.embeddings?.map((e: any) => e.values) || []
      allVecs.push(...vecs)
    }
    return allVecs
  } catch {
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