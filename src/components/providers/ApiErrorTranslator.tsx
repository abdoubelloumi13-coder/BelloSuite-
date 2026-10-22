'use client'

import { useEffect } from 'react'
import { wrapFetchWithErrorTranslation } from '@/lib/client-errors'

const FLAG = '__belloApiErrorTranslator'

/**
 * Installé une seule fois dans le layout [locale] : les erreurs génériques anglaises des API
 * (« Internal error », « Internal Server Error »…) sont traduites avant d'être lues par les pages.
 */
export function ApiErrorTranslator() {
  useEffect(() => {
    const w = window as typeof window & { [FLAG]?: boolean }
    if (w[FLAG]) return
    w[FLAG] = true
    window.fetch = wrapFetchWithErrorTranslation(window.fetch.bind(window))
  }, [])
  return null
}
