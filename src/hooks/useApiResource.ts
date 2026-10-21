'use client'

import { useCallback, useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { readApiError, translateGenericError } from '@/lib/client-errors'

/** Charge une ressource JSON (GET) avec gestion res.ok : { data, loading, error, notFound, reload }. */
export function useApiResource<T>(url: string | null) {
  const locale = useLocale()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(Boolean(url))
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const reload = useCallback(async () => {
    if (!url) return
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const res = await fetch(url)
      if (res.status === 404) { setNotFound(true); setData(null); return }
      if (!res.ok) { setError(await readApiError(res, locale)); return }
      setData(await res.json() as T)
    } catch {
      setError(translateGenericError('Failed to fetch', locale))
    } finally {
      setLoading(false)
    }
  }, [url, locale])

  useEffect(() => { reload() }, [reload])

  return { data, setData, loading, error, notFound, reload }
}
