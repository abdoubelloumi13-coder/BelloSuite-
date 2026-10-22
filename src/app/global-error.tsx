'use client'

import { useEffect } from 'react'

// Erreur dans un layout racine : remplace tout le document, donc sans next-intl ni CSS garantie.
const TEXT = {
  fr: { title: 'Une erreur inattendue est survenue', desc: "L'application n'a pas pu s'afficher. Réessayez ; si le problème persiste, contactez le support.", retry: 'Réessayer', home: 'Accueil' },
  en: { title: 'An unexpected error occurred', desc: 'The application could not be displayed. Please try again; if the problem persists, contact support.', retry: 'Try again', home: 'Home' },
  ar: { title: 'حدث خطأ غير متوقع', desc: 'تعذر عرض التطبيق. أعد المحاولة، وإذا استمر المشكل اتصل بالدعم.', retry: 'إعادة المحاولة', home: 'الرئيسية' },
} as const

function pathLocale(): keyof typeof TEXT {
  if (typeof window === 'undefined') return 'fr'
  const seg = window.location.pathname.split('/')[1]
  return seg === 'en' || seg === 'ar' ? seg : 'fr'
}

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  const locale = pathLocale()
  const t = TEXT[locale]
  return (
    <html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#fafaf9', color: '#1c1917' }}>
        <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div role="alert" style={{ maxWidth: 440, width: '100%', textAlign: 'center', background: '#fff', border: '1px solid #fecaca', borderRadius: 24, padding: 40 }}>
            <h1 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 12px' }}>{t.title}</h1>
            <p style={{ fontSize: 14, color: '#78716c', margin: '0 0 8px' }}>{t.desc}</p>
            {error.digest && <p style={{ fontSize: 12, color: '#a8a29e', fontFamily: 'monospace' }}>Réf. {error.digest}</p>}
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
              <button onClick={() => reset()} style={{ padding: '10px 20px', borderRadius: 12, border: 0, background: '#0d9488', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{t.retry}</button>
              <a href={`/${locale}`} style={{ padding: '10px 20px', borderRadius: 12, background: '#f5f5f4', color: '#44403c', fontWeight: 700, textDecoration: 'none' }}>{t.home}</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
