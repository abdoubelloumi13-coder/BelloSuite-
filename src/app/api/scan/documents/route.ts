import { Prisma } from '@prisma/client'
import { scanDocumentCreateSchema, SCAN_DOCUMENT_MAX_BODY } from '@/lib/security/update-schemas'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

/**
 * GET /api/scan/documents?query=&kind=&dateFrom=&dateTo=&supplier=&page=&limit=
 * Recherche full-text + filtres sur les documents scannés
 */
export async function GET(req: Request) {
  const auth = await requireTenant(req)
  if (auth instanceof NextResponse) return auth

  try {
    const sp = new URL(req.url).searchParams
    const query = sp.get('query')?.trim() || ''
    const kind = sp.get('kind') || undefined
    const supplier = sp.get('supplier')?.trim() || undefined
    const dateFrom = sp.get('dateFrom') ? new Date(sp.get('dateFrom')!) : undefined
    const dateTo = sp.get('dateTo') ? new Date(sp.get('dateTo')!) : undefined
    const page = Math.max(1, parseInt(sp.get('page') || '1', 10))
    const limit = Math.min(50, Math.max(1, parseInt(sp.get('limit') || '20', 10)))
    const sort = sp.get('sort') || 'date_desc'

    // Construire where clause
    const where: any = { tenantId: auth.tenantId }

    if (kind) where.documentKind = kind
    const reviewStatus = sp.get('reviewStatus')
    if (reviewStatus && ['TO_REVIEW', 'PROCESSED', 'REJECTED'].includes(reviewStatus)) where.reviewStatus = reviewStatus
    if (supplier) where.supplierName = { contains: supplier, mode: 'insensitive' }
    if (dateFrom || dateTo) {
      where.date = {}
      if (dateFrom) where.date.gte = dateFrom
      if (dateTo) where.date.lte = dateTo
    }

    // Recherche full-text
    if (query) {
      // Recherche PostgreSQL to_tsvector (si migration faite)
      // Sinon fallback sur recherche ILIKE
      where.OR = [
        { extractedText: { contains: query, mode: 'insensitive' } },
        { supplierName: { contains: query, mode: 'insensitive' } },
        { reference: { contains: query, mode: 'insensitive' } },
        { fileName: { contains: query, mode: 'insensitive' } },
      ]
    }

    // Tri
    let orderBy: any = { createdAt: 'desc' }
    if (sort === 'date_asc') orderBy = { date: 'asc' }
    else if (sort === 'date_desc') orderBy = { date: 'desc' }
    else if (sort === 'amount_desc') orderBy = { totalAmount: 'desc' }
    else if (sort === 'amount_asc') orderBy = { totalAmount: 'asc' }
    else if (sort === 'relevance' && query) {
      // Pour pertinence, on trie par correspondance exacte d'abord
      orderBy = { createdAt: 'desc' }
    }

    const [total, docs] = await Promise.all([
      prisma.scannedDocument.count({ where }),
      prisma.scannedDocument.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          fileName: true,
          fileType: true,
          fileSize: true,
          documentKind: true,
          supplierName: true,
          supplierMf: true,
          reference: true,
          date: true,
          totalAmount: true,
          currency: true,
          extractedText: true,
          avgConfidence: true,
          lowConfidence: true,
          reviewStatus: true,
          purchaseId: true,
          createdAt: true,
        },
      }),
    ])

    // Highlight des résultats si query
    const highlighted = docs.map(doc => {
      let snippet = doc.extractedText
      if (query && snippet) {
        const idx = snippet.toLowerCase().indexOf(query.toLowerCase())
        if (idx >= 0) {
          const start = Math.max(0, idx - 60)
          const end = Math.min(snippet.length, idx + query.length + 60)
          snippet = '…' + snippet.slice(start, end) + '…'
        } else {
          snippet = snippet.slice(0, 120) + '…'
        }
      } else if (snippet) {
        snippet = snippet.slice(0, 120) + '…'
      }
      return { ...doc, snippet }
    })

    return NextResponse.json({
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      documents: highlighted,
    })
  } catch (e) {
    console.error('[scan] search error', e)
    return NextResponse.json({ error: 'Erreur recherche' }, { status: 500 })
  }
}

/**
 * POST /api/scan/documents — Enregistrer un document scanné
 * Corps : { fileName, fileType, fileSize, fileHash, extractedText, documentKind, supplierName, supplierMf, reference, date, totalAmount, currency, lines, avgConfidence, lowConfidence }
 */
export async function POST(req: Request) {
  const auth = await requireTenant(req)
  if (auth instanceof NextResponse) return auth

  try {
    // Corps borné (1 Mo) et validé : texte OCR ≤ 200 000 caractères, ≤ 1 000 lignes (audit M2)
    const raw = await req.text()
    if (raw.length > SCAN_DOCUMENT_MAX_BODY) return NextResponse.json({ error: 'Document trop volumineux' }, { status: 413 })
    let json: unknown
    try { json = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    const parsed = scanDocumentCreateSchema.safeParse(json)
    if (!parsed.success) return NextResponse.json({ error: 'Données invalides', details: parsed.error.issues }, { status: 400 })
    const body = parsed.data

    // Déduplication par hash
    if (body.fileHash) {
      const existing = await prisma.scannedDocument.findFirst({
        where: { tenantId: auth.tenantId, fileHash: body.fileHash },
        select: { id: true },
      })
      if (existing) {
        return NextResponse.json({ id: existing.id, duplicate: true })
      }
    }

    const doc = await prisma.scannedDocument.create({
      data: {
        tenantId: auth.tenantId,
        fileName: body.fileName,
        fileType: body.fileType,
        fileSize: body.fileSize,
        fileHash: body.fileHash || '',
        extractedText: body.extractedText || '',
        documentKind: body.documentKind || null,
        supplierName: body.supplierName || null,
        supplierMf: body.supplierMf || null,
        reference: body.reference || null,
        date: body.date ? new Date(body.date) : null,
        totalAmount: body.totalAmount || null,
        currency: body.currency || 'TND',
        lines: (body.lines as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        avgConfidence: body.avgConfidence || null,
        lowConfidence: body.lowConfidence || false,
        source: body.source || 'SCAN',
        createdBy: auth.user.id,
      },
    })

    return NextResponse.json(doc, { status: 201 })
  } catch (e) {
    console.error('[scan] create error', e)
    return NextResponse.json({ error: 'Erreur création' }, { status: 500 })
  }
}