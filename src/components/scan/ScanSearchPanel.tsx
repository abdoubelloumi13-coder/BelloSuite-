'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, FileText, Filter, X, Loader2, Calendar, Euro, Package, Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useStockFormat } from '@/components/stock/ui'

interface Doc {
  id: string
  fileName: string
  fileType: string
  fileSize: number
  documentKind: string | null
  supplierName: string | null
  supplierMf: string | null
  reference: string | null
  date: string | null
  totalAmount: number | null
  currency: string
  extractedText: string | null
  snippet?: string
  similarity?: number
  createdAt: string
}

const KIND_LABELS: Record<string, string> = {
  INVOICE: 'Facture',
  ORDER: 'Bon de commande',
  QUOTE: 'Devis',
  DELIVERY_NOTE: 'Bon de livraison',
}

export function ScanSearchPanel() {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [supplier, setSupplier] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sort, setSort] = useState('date_desc')
  const [semantic, setSemantic] = useState(true)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Doc[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const hasFilters = query || kind || supplier || dateFrom || dateTo

  const doSearch = useCallback(async (p = 1) => {
    setLoading(true)
    setError(null)
    try {
      const endpoint = semantic ? '/api/scan/search-semantic' : '/api/scan/documents'
      const body = semantic
        ? { query, limit: 50, threshold: 0.55 }
        : null

      const params = new URLSearchParams({
        page: String(p),
        limit: '20',
        sort,
        ...(query && { query }),
        ...(kind && { kind }),
        ...(supplier && { supplier }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
      })

      const res = await fetch(
        semantic ? endpoint : `${endpoint}?${params}`,
        semantic ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setResults(data.results || data.documents || [])
      setTotal(data.total || 0)
      setPage(p)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [query, kind, supplier, dateFrom, dateTo, sort, semantic])

  useEffect(() => { doSearch(1) }, [doSearch])

  const clearFilters = () => {
    setQuery(''); setKind(''); setSupplier(''); setDateFrom(''); setDateTo('')
  }

  const kindOptions = [
    { value: '', label: t('all_docs') },
    { value: 'INVOICE', label: 'Facture' },
    { value: 'ORDER', label: 'Bon de commande' },
    { value: 'QUOTE', label: 'Devis' },
    { value: 'DELIVERY_NOTE', label: 'Bon de livraison' },
  ]

  const sortOptions = [
    { value: 'date_desc', label: t('sort_date_desc') },
    { value: 'date_asc', label: t('sort_date_asc') },
    { value: 'amount_desc', label: t('sort_amount_desc') },
    { value: 'amount_asc', label: t('sort_amount_asc') },
    { value: 'relevance', label: t('sort_relevance') },
  ]

  return (
    <div className="space-y-4">
      {/* Barre de recherche */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="w-5 h-5 absolute start-4 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('search_placeholder')}
            className="w-full ps-12 pe-4 py-3 rounded-xl border border-zinc-300 bg-white focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none"
          />
        </div>
        <button
          onClick={() => setSemantic(!semantic)}
          className={`px-4 py-3 rounded-xl border-2 transition-colors ${semantic ? 'border-teal-500 bg-teal-50 text-teal-700' : 'border-zinc-300 bg-white text-zinc-500'}`}
          title={t('semantic_search')}
        >
          {semantic ? '🧠' : '🔍'}
        </button>
      </div>

      {/* Filtres avancés */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <select value={kind} onChange={e => setKind(e.target.value)} className="px-3 py-2 rounded-xl border border-zinc-300 bg-white text-sm">
          {kindOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="text"
          value={supplier}
          onChange={e => setSupplier(e.target.value)}
          placeholder={t('supplier_filter')}
          className="px-3 py-2 rounded-xl border border-zinc-300 bg-white text-sm"
        />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-3 py-2 rounded-xl border border-zinc-300 bg-white text-sm" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-3 py-2 rounded-xl border border-zinc-300 bg-white text-sm" />
      </div>

      <div className="flex items-center gap-3">
        <select value={sort} onChange={e => setSort(e.target.value)} className="px-3 py-2 rounded-xl border border-zinc-300 bg-white text-sm">
          {sortOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {hasFilters && (
          <button onClick={clearFilters} className="text-sm text-zinc-500 hover:text-zinc-800 flex items-center gap-1">
            <X className="w-4 h-4" /> {t('clear')}
          </button>
        )}
      </div>

      {/* Résultats */}
      {loading ? (
        <div className="text-center py-12"><Loader2 className="w-8 h-8 animate-spin mx-auto text-teal-500" /></div>
      ) : error ? (
        <div className="text-center py-12 text-red-600">{t('search_error')}: {error}</div>
      ) : results.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <FileText className="w-12 h-12 mx-auto mb-3 text-zinc-300" />
          <p>{t('no_results')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-zinc-500">
            {total} résultat(s) — page {page} / {Math.ceil(total / 20)}
          </p>
          {results.map(doc => (
            <DocCard key={doc.id} doc={doc} semantic={semantic} />
          ))}
        </div>
      )}
    </div>
  )
}

function DocCard({ doc, semantic }: { doc: Doc; semantic: boolean }) {
  const t = useTranslations('Purchases')
  const f = useStockFormat()

  return (
    <div className="p-4 rounded-xl border border-zinc-200 hover:border-teal-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-teal-50 text-teal-600 shrink-0">
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-zinc-900 truncate">{doc.fileName}</p>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-zinc-500">
              {doc.documentKind && (
                <span className="px-2 py-0.5 rounded-full bg-zinc-100">{KIND_LABELS[doc.documentKind] || doc.documentKind}</span>
              )}
              {doc.supplierName && <span>{doc.supplierName}</span>}
              {doc.reference && <span className="font-mono">#{doc.reference}</span>}
              {doc.date && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {new Date(doc.date).toLocaleDateString('fr-FR')}
                </span>
              )}
              {doc.totalAmount !== null && (
                <span className="flex items-center gap-1">
                  <Euro className="w-3 h-3" />
                  {f.money(doc.totalAmount)}
                </span>
              )}
            </div>
          </div>
        </div>
        {semantic && doc.similarity !== undefined && (
          <span className={`px-2 py-1 rounded-full text-xs font-bold shrink-0 ${
            doc.similarity >= 0.8 ? 'bg-green-100 text-green-700' :
            doc.similarity >= 0.65 ? 'bg-amber-100 text-amber-700' :
            'bg-zinc-100 text-zinc-600'
          }`}>
            {Math.round(doc.similarity * 100)}%
          </span>
        )}
      </div>
      {doc.snippet && (
        <p className="mt-2 text-sm text-zinc-600 line-clamp-2">{doc.snippet}</p>
      )}
    </div>
  )
}