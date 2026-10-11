/**
 * En-têtes de sécurité HTTP (dont la CSP), appliqués à toutes les routes via next.config.ts.
 *
 * Politique pragmatique, sans nonce :
 *  - script-src 'unsafe-inline' : Next (App Router) injecte des scripts inline (payload RSC) ;
 *    'unsafe-eval' uniquement en développement (Fast Refresh).
 *  - style-src 'unsafe-inline' : styles inline générés par Next / gsap / attributs style.
 *  - connect-src : l'API Supabase (https + wss pour Realtime).
 *  - img-src https: : les images produits sont des URL saisies par l'utilisateur, avatars dicebear.
 *  - Google OAuth passe par une redirection de page (pas d'iframe) : rien à autoriser côté CSP
 *    hormis form-action vers Supabase/Google par précaution.
 *  - Polices : next/font les auto-héberge (font-src 'self').
 *  - Vidéos de la landing servies depuis /videos (media-src 'self').
 *  - Import de facture fournisseur (OCR dans le navigateur) : pdfjs-dist et tesseract.js chargent leurs workers,
 *    le cœur WASM et les données de langue depuis le CDN jsdelivr (script-src + connect-src), et compilent du
 *    WebAssembly ('wasm-unsafe-eval', qui n'autorise PAS eval() JavaScript).
 */
export const OCR_CDN = 'https://cdn.jsdelivr.net'

export function supabaseOrigin(url: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL): string | null {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

export function buildContentSecurityPolicy(opts: { supabaseUrl?: string; isDev?: boolean } = {}): string {
  const isDev = opts.isDev ?? process.env.NODE_ENV !== 'production'
  const supa = supabaseOrigin(opts.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL)
  const supaHttp = supa ?? 'https://*.supabase.co'
  const supaWs = supa ? supa.replace(/^https:/, 'wss:') : 'wss://*.supabase.co'

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", OCR_CDN, ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    // Vidéos de démo auto-hébergées (public/videos)
    'media-src': ["'self'"],
    'connect-src': ["'self'", supaHttp, supaWs, OCR_CDN, ...(isDev ? ['ws:', 'http://localhost:*'] : [])],
    'frame-src': ["'self'", 'blob:'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", supaHttp, 'https://accounts.google.com'],
    'frame-ancestors': ["'none'"],
  }
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`)
  if (!isDev) parts.push('upgrade-insecure-requests')
  return parts.join('; ')
}

export function securityHeaders(opts: { supabaseUrl?: string; isDev?: boolean } = {}): Array<{ key: string; value: string }> {
  return [
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(opts) },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'X-DNS-Prefetch-Control', value: 'on' },
  ]
}
