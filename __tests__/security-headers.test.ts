import { buildContentSecurityPolicy, securityHeaders } from '@/lib/security-headers'

describe('security headers', () => {
  it('CSP prod : Supabase autorisé, pas d’unsafe-eval, frame-ancestors none', () => {
    const csp = buildContentSecurityPolicy({ supabaseUrl: 'https://abc.supabase.co', isDev: false })
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co wss://abc.supabase.co https://cdn.jsdelivr.net")
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).not.toContain("'unsafe-eval'")
    // OCR navigateur (pdfjs / tesseract.js) : WASM + CDN jsdelivr
    expect(csp).toContain("'wasm-unsafe-eval' https://cdn.jsdelivr.net")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain('upgrade-insecure-requests')
    expect(csp).toContain("media-src 'self'")
  })
  it('CSP dev : unsafe-eval (Fast Refresh) et websockets locaux', () => {
    const csp = buildContentSecurityPolicy({ supabaseUrl: 'https://abc.supabase.co', isDev: true })
    expect(csp).toContain("'unsafe-eval'")
    expect(csp).not.toContain('upgrade-insecure-requests')
  })
  it('repli générique si NEXT_PUBLIC_SUPABASE_URL absent', () => {
    expect(buildContentSecurityPolicy({ supabaseUrl: '', isDev: false })).toContain('https://*.supabase.co')
  })
  it('en-têtes complémentaires', () => {
    const keys = securityHeaders({ isDev: false }).map((h) => h.key)
    expect(keys).toEqual(expect.arrayContaining(['Content-Security-Policy', 'X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']))
  })
  it('caméra et micro autorisés pour le site seul (scan, dictée), géoloc / paiement refusés', () => {
    const pp = securityHeaders({ isDev: false }).find((h) => h.key === 'Permissions-Policy')!.value
    expect(pp).toContain('camera=(self)')
    expect(pp).toContain('microphone=(self)') // dictée vocale (Speech-to-Devis), même origine seulement
    expect(pp).toContain('geolocation=()')
    expect(pp).toContain('payment=()')
  })
})
