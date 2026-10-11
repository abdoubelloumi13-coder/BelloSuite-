'use client'

/** Widget tableau de bord « Points à vérifier » : nombre d'anomalies ouvertes + top 3 (masqué si la migration n'est pas appliquée). */
import React, { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react'
import { Link } from '@/i18n/routing'
import { documentPath, pickTop } from '@/lib/anomalies'
import { Badge } from '@/components/stock/ui'
import { SEVERITY_TONE, useAnomalyText, type AnomalyList } from '@/components/anomalies/shared'

export function AnomaliesWidget() {
  const t = useTranslations('Anomalies')
  const text = useAnomalyText()
  const [data, setData] = useState<AnomalyList | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/anomalies?status=OPEN&limit=50')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (alive) setData(d) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  if (!data || data.tableMissing) return null
  const top = pickTop(data.items, 3)

  return (
    <div className="bg-white rounded-[2rem] p-6 border border-stone-200 shadow-sm">
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-2xl ${data.counts.OPEN ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {data.counts.OPEN ? <AlertTriangle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
          </div>
          <div>
            <h3 className="font-black text-stone-900">{t('widget_title')}</h3>
            <p className="text-xs text-stone-500">{data.counts.OPEN ? t('widget_count', { count: data.counts.OPEN }) : t('widget_empty')}</p>
          </div>
        </div>
        <Link href="/anomalies" className="text-sm font-bold text-teal-700 hover:text-teal-800 flex items-center gap-1 group">
          {t('view_all')} <ArrowRight className="w-4 h-4 rtl:rotate-180" />
        </Link>
      </div>
      {top.length > 0 && (
        <ul className="space-y-2">
          {top.map(a => {
            const { title, detail } = text(a)
            return (
              <li key={a.id}>
                <Link href={documentPath(a.documentKind, a.documentId)} className="block p-3 rounded-xl bg-stone-50 hover:bg-stone-100 transition-colors">
                  <div className="flex items-center gap-2 mb-0.5">
                    <Badge tone={SEVERITY_TONE[a.severity]}>{t(`severity.${a.severity as 'HIGH'}`)}</Badge>
                    <span className="font-bold text-sm text-stone-900 truncate">{title}</span>
                  </div>
                  <p className="text-xs text-stone-500 line-clamp-2">{detail}</p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
