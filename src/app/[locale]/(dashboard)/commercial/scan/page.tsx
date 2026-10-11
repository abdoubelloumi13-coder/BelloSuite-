'use client'

/**
 * « Scanner un document » : photo (caméra) ou fichier d'une pièce fournisseur → extraction → type détecté + résumé,
 * puis création d'une facture fournisseur ou d'un bon de commande pré-rempli (extraction transmise par sessionStorage).
 * Authentification / tenant : layout (dashboard) ; l'extraction IA passe par /api/ai/extract-invoice (session requise).
 */
import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/routing'
import { FileText, Package, RotateCcw } from 'lucide-react'
import { StockPage, PageHeader, Card, Alert, cls, useStockFormat } from '@/components/stock/ui'
import { InvoiceImportPanel } from '@/components/purchases/InvoiceImport'
import type { InvoiceExtraction } from '@/lib/invoice-extract'
import { summarizeExtraction, type PurchaseTarget } from '@/lib/scan-document'
import { saveScanHandoff, scanTargetHref } from '@/lib/scan-handoff'

export default function ScanDocumentPage() {
  const t = useTranslations('Purchases')
  const f = useStockFormat()
  const router = useRouter()
  const [x, setX] = useState<InvoiceExtraction | null>(null)
  const [error, setError] = useState('')
  const [panelKey, setPanelKey] = useState(0)
  const s = x ? summarizeExtraction(x) : null

  function create(target: PurchaseTarget) {
    if (!x) return
    if (!saveScanHandoff(window.sessionStorage, target, x)) { setError(t('scan_handoff_failed')); return }
    router.push(scanTargetHref(target))
  }

  const btn = (target: PurchaseTarget) => (s?.suggested === target ? cls.btnPrimary : cls.btnSecondary)

  return (
    <StockPage>
      <PageHeader title={t('scan_title')} description={t('scan_desc')} />
      {error && <Alert onClose={() => setError('')}>{error}</Alert>}
      <div className="max-w-3xl">
        <InvoiceImportPanel key={panelKey} variant="scan" onExtracted={setX} />
        {s && (
          <Card title={t('scan_result_title')}>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-start">
              <div><dt className="text-xs text-zinc-500">{t('scan_detected_type')}</dt><dd className="font-semibold">{t(`doc_kind_${s.kind ?? 'UNKNOWN'}` as 'doc_kind_INVOICE')}</dd></div>
              <div><dt className="text-xs text-zinc-500">{t('supplier')}</dt><dd className="font-semibold">{s.supplierName ?? '—'}{s.matriculeFiscal && <span className="ms-2 font-mono text-xs text-zinc-500">{s.matriculeFiscal}</span>}</dd></div>
              <div><dt className="text-xs text-zinc-500">{t('scan_reference')}</dt><dd className="font-mono">{s.reference ?? '—'}</dd></div>
              <div><dt className="text-xs text-zinc-500">{t('date')}</dt><dd>{s.date ? f.date(s.date) : '—'}</dd></div>
              <div><dt className="text-xs text-zinc-500">{t('lines')}</dt><dd className="tabular-nums">{s.lineCount}</dd></div>
              <div><dt className="text-xs text-zinc-500">{t('subtotal')} / {t('total_ttc')}</dt><dd className="tabular-nums">{s.subtotal !== null ? f.money(s.subtotal) : '—'} / <b>{s.total !== null ? f.money(s.total) : '—'}</b></dd></div>
            </dl>
            <p className="mt-4 text-xs text-zinc-500 text-start">{t('scan_choose_hint')}</p>
            <div className="mt-3 flex flex-col sm:flex-row flex-wrap gap-2">
              <button type="button" className={btn('INVOICE')} onClick={() => create('INVOICE')}><FileText className="w-4 h-4" /> {t('scan_create_invoice')}</button>
              <button type="button" className={btn('ORDER')} onClick={() => create('ORDER')}><Package className="w-4 h-4" /> {t('scan_create_order')}</button>
              <button type="button" className={cls.btnGhost} onClick={() => { setX(null); setPanelKey(k => k + 1) }}><RotateCcw className="w-4 h-4" /> {t('scan_again')}</button>
            </div>
          </Card>
        )}
      </div>
    </StockPage>
  )
}
