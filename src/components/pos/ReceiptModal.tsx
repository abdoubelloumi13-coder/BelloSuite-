'use client'

import { useRef } from 'react'
import { X, Printer } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'

interface ReceiptModalProps {
  order: any // eslint-disable-line @typescript-eslint/no-explicit-any
  onClose: () => void
}

function formatMoney(amount: number, locale = 'fr') {
  return amount.toLocaleString(`${locale}-TN`, { style: 'currency', currency: 'TND', minimumFractionDigits: 3 })
}

export default function ReceiptModal({ order, onClose }: ReceiptModalProps) {
  const t = useTranslations('POS.receipt')
  const locale = useLocale()
  const lc = `${locale}-TN`
  const printRef = useRef<HTMLDivElement>(null)

  const handlePrint = () => {
    const printContent = printRef.current
    if (!printContent) return
    const win = window.open('', '', 'width=300,height=600')
    if (!win) return
    win.document.write(`
      <html dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><head><title>${t('ticket_title', { number: order.orderNumber })}</title>
      <style>
        body { font-family: monospace; width: 280px; padding: 10px; font-size: 12px; }
        .center { text-align: center; } .bold { font-weight: bold; }
        .right { text-align: end; }
        .border-top { border-top: 1px dashed #000; padding-top: 8px; margin-top: 8px; }
        table { width: 100%; border-collapse: collapse; }
        td { padding: 2px 0; vertical-align: top; }
        .total-row { font-weight: bold; font-size: 14px; }
      </style></head><body>
      <div class="center bold">BELLO SUITE</div>
      <div class="center">${t('till_no', { id: order.sessionId?.slice(-4) || '0000' })}</div>
      <div class="center">${new Date().toLocaleDateString(lc)} ${new Date().toLocaleTimeString(lc)}</div>
      <div class="center bold">${order.orderNumber}</div>
      <div class="border-top"></div>
      <table>
        ${order.items.map((item: any) => `
          <tr>
            <td>${item.description}</td>
            <td class="right">x${item.quantity}</td>
            <td class="right">${Number(item.totalTTC).toFixed(3)}</td>
          </tr>`).join('')}
      </table>
      <div class="border-top"></div>
      <table>
        <tr><td>${t('ht')}</td><td class="right">${Number(order.subtotalHT).toFixed(3)}</td></tr>
        <tr><td>${t('vat')}</td><td class="right">${Number(order.totalVAT).toFixed(3)}</td></tr>
        ${Number(order.discountAmount) > 0 ? `<tr><td>Remise</td><td class="right">-${Number(order.discountAmount).toFixed(3)}</td></tr>` : ''}
        ${Number(order.timbreFiscal) > 0 ? `<tr><td>${t('stamp')}</td><td class="right">${Number(order.timbreFiscal).toFixed(3)}</td></tr>` : ''}
        <tr class="total-row"><td>${t('total_ttc')}</td><td class="right">${Number(order.totalTTC).toFixed(3)} DT</td></tr>
      </table>
      ${Number(order.changeGiven) > 0 ? `<table><tr><td>Reçu</td><td class="right">${Number(order.paidAmount).toFixed(3)}</td></tr><tr><td>Rendu</td><td class="right">${Number(order.changeGiven).toFixed(3)}</td></tr></table>` : ''}
      ${order.isPaid ? `<div class="center bold">${t('paid')}</div>` : ''}
      <div class="center border-top">${t('thanks')}</div>
      </body></html>`)
    win.document.close()
    win.print()
    win.close()
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="p-4 border-b border-stone-100 flex items-center justify-between bg-stone-50">
          <h3 className="font-black text-stone-900">{t('title')}</h3>
          <button onClick={onClose} className="p-2 hover:bg-stone-200 rounded-xl">
            <X className="w-5 h-5 text-stone-400" />
          </button>
        </div>
        <div className="p-4">
          <div ref={printRef} className="bg-white border border-stone-200 rounded-xl p-4 font-mono text-sm space-y-1">
            <div className="text-center font-bold border-b border-dashed border-stone-300 pb-2 mb-2">BELLO SUITE</div>
            <div className="text-center text-xs text-stone-500">{t('ticket_no', { number: order.orderNumber })}</div>
            <div className="text-center text-xs text-stone-400">{new Date().toLocaleString(lc)}</div>
            <div className="border-t border-dashed border-stone-300 pt-2 mt-2 space-y-1">
              {order.items.map((item: any, i: number) => (
                <div key={i} className="flex justify-between text-xs">
                  <span>{item.description} x{item.quantity}</span>
                  <span>{formatMoney(Number(item.totalTTC), locale)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed border-stone-300 pt-2 mt-2 space-y-1 text-xs">
              <div className="flex justify-between"><span>{t('ht')}</span><span>{formatMoney(Number(order.subtotalHT), locale)}</span></div>
              <div className="flex justify-between"><span>{t('vat')}</span><span>{formatMoney(Number(order.totalVAT), locale)}</span></div>
              {Number(order.discountAmount) > 0 && <div className="flex justify-between"><span>Remise</span><span>-{formatMoney(Number(order.discountAmount), locale)}</span></div>}
              {/* Timbre affiché uniquement s'il a été appliqué (réglage caisse, défaut : non) */}
              {Number(order.timbreFiscal) > 0 && <div className="flex justify-between"><span>{t('stamp')}</span><span>{formatMoney(Number(order.timbreFiscal), locale)}</span></div>}
              <div className="flex justify-between font-bold text-base border-t border-dashed border-stone-300 pt-1 mt-1">
                <span>{t('total_ttc')}</span><span>{formatMoney(Number(order.totalTTC), locale)}</span>
              </div>
              {order.isPaid && <div className="text-center text-emerald-600 font-bold">✓ {t('paid')}</div>}
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={onClose} className="flex-1 py-2.5 border border-stone-200 rounded-xl font-bold text-stone-600 hover:bg-stone-50">
              {t('close')}
            </button>
            <button onClick={handlePrint} className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold flex items-center justify-center gap-2">
              <Printer className="w-4 h-4" /> {t('print')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}