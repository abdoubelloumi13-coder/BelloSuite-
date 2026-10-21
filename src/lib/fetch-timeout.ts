/** fetch avec délai maximal : rejette (AbortError) au-delà de `ms` — évite une UI bloquée sur un spinner. */
export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, ms = 30_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/** Promesse avec délai maximal : renvoie `fallback` si elle n'aboutit pas à temps (ou échoue). */
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), ms) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
