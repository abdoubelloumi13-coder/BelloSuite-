'use client'

/** Types et helpers partagés par le widget « Points à vérifier » et la page /anomalies. */
import { useTranslations } from 'next-intl'
import { ANOMALY_TYPES } from '@/lib/anomalies'

export type AnomalyRow = {
  id: string
  type: string
  severity: string
  score: number
  fingerprint: string
  documentKind: string | null
  documentId: string | null
  documentRef: string | null
  amount: number | null
  details: Record<string, string | number>
  status: 'OPEN' | 'IGNORED' | 'RESOLVED'
  firstSeenAt: string
  lastSeenAt: string
}

export type AnomalyList = {
  items: AnomalyRow[]
  counts: { OPEN: number; IGNORED: number; RESOLVED: number }
  lastRun: { startedAt: string; openCount: number; trigger: string } | null
  tableMissing?: boolean
}

export const SEVERITY_TONE: Record<string, string> = { CRITICAL: 'red', HIGH: 'red', MEDIUM: 'amber', LOW: 'zinc' }

const KNOWN = new Set<string>(ANOMALY_TYPES)

/** Titre + détail traduits d'une anomalie. */
export function useAnomalyText() {
  const t = useTranslations('Anomalies')
  return (a: Pick<AnomalyRow, 'type' | 'details'>) => {
    if (!KNOWN.has(a.type)) return { title: a.type, detail: '' }
    const key = a.type as (typeof ANOMALY_TYPES)[number]
    const params = Object.fromEntries(Object.entries(a.details || {}).map(([k, v]) => [k, String(v)]))
    return { title: t(`types.${key}.title`), detail: t(`types.${key}.detail`, params) }
  }
}
