import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/routing'
import {
  ArrowRight,
  Boxes,
  CalendarCheck,
  ClipboardList,
  Check,
  FileText,
  FileSpreadsheet,
  Layers,
  PackageSearch,
  Play,
  ShieldCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'

// Adresse de contact commerciale : à définir dans Vercel (NEXT_PUBLIC_SALES_EMAIL).
const SALES_EMAIL = process.env.NEXT_PUBLIC_SALES_EMAIL || 'belloumi.karim.professional@gmail.com'

export default function Home() {
  const t = useTranslations('Landing')
  const tl = useTranslations('Legal')
  const locale = useLocale()
  // Lien démo en <a> classique : la route API pose le cookie puis redirige vers le tableau de bord.
  // (Un <Link> client ne suit pas proprement une redirection vers une route API.)
  const demoHref = `/api/auth/demo?locale=${locale}`

  const mailto = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(t('mail.subject'))}&body=${encodeURIComponent(t('mail.body'))}`
  const painItems = [0, 1, 2, 3].map(i => t(`pain.items.${i}`))
  const localItems = [0, 1, 2, 3, 4, 5].map(i => t(`local.items.${i}`))
  const benefits = [FileSpreadsheet, ShieldCheck, Boxes, Wallet, FileText, Users]

  // Vidéo de démo dans la langue de la page : derja pour l'arabe, anglais pour l'anglais, français sinon.
  const videoLang = locale === 'ar' || locale === 'en' ? locale : 'fr'
  const videoSrc = `/videos/bellosuite-${videoLang}.mp4`
  const videoPoster = `/videos/bellosuite-${videoLang}-poster.jpg`

  // Scénarios : la connexion démo redirige vers la page indiquée (liste blanche dans src/lib/demo-redirect.ts).
  const scenarios = [
    { icon: ClipboardList, next: '/commercial/documents/estimates' },
    { icon: PackageSearch, next: '/stock/products' },
    { icon: Wallet, next: '/commercial/treasury' },
  ].map((s, i) => ({
    ...s,
    title: t(`scenarios.items.${i}.title`),
    text: t(`scenarios.items.${i}.text`),
    href: `/api/auth/demo?locale=${locale}&next=${encodeURIComponent(s.next)}`,
  }))

  const btnPrimary =
    'inline-flex items-center justify-center gap-2 px-7 py-4 rounded-xl bg-amber-500 text-zinc-950 font-bold text-lg shadow-lg shadow-amber-500/30 hover:bg-amber-400 transition-colors group'
  const btnDemo =
    'inline-flex items-center justify-center gap-2 px-7 py-4 rounded-xl bg-white text-zinc-950 font-bold text-lg hover:bg-zinc-100 transition-colors'
  const btnGhost =
    'inline-flex items-center justify-center gap-2 px-7 py-4 rounded-xl border-2 border-white/30 text-white font-semibold text-lg hover:border-white hover:bg-white/10 transition-colors'

  return (
    <div className="min-h-screen bg-white text-zinc-900 font-sans">
      {/* En-tête */}
      <header className="absolute top-0 inset-x-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
              <Layers className="text-zinc-950 w-5 h-5" />
            </div>
            <span className="text-xl font-extrabold tracking-tight text-white">BelloSuite</span>
          </div>
          <div className="flex items-center gap-3 sm:gap-5">
            <LanguageSwitcher />
            <a href={demoHref} className="hidden sm:inline text-sm font-semibold text-white/80 hover:text-white">
              {t('nav.demo')}
            </a>
            <Link href="/login" className="text-sm font-semibold text-white/80 hover:text-white">
              {t('nav.login')}
            </Link>
            <Link href="/register" className="text-sm font-bold px-4 py-2 bg-amber-500 text-zinc-950 rounded-lg hover:bg-amber-400">
              {t('nav.trial')}
            </Link>
          </div>
        </div>
      </header>

      {/* Héros */}
      <section className="relative overflow-hidden bg-zinc-950 text-white pt-36 pb-28 px-4 sm:px-6 lg:px-8">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.25),transparent_60%)]" />
        <div className="relative max-w-5xl mx-auto text-center">
          <p className="inline-block mb-6 px-4 py-1.5 rounded-full border border-amber-500/40 text-amber-400 text-sm font-semibold tracking-wide uppercase">
            {t('hero.kicker')}
          </p>
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-black tracking-tight leading-[1.05] mb-8">
            {t('hero.title1')}
            <br />
            <span className="text-amber-400">{t('hero.title2')}</span>
          </h1>
          <p className="text-xl md:text-2xl text-zinc-300 max-w-3xl mx-auto mb-12">{t('hero.subtitle')}</p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link href="/register" className={btnPrimary}>
              {t('hero.trial')}
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 rtl:rotate-180 transition-transform" />
            </Link>
            <a href={demoHref} className={btnDemo}>
              <Play className="w-5 h-5" />
              {t('hero.demo')}
            </a>
            <a href={mailto} className={btnGhost}>
              <CalendarCheck className="w-5 h-5" />
              {t('hero.meeting')}
            </a>
          </div>
          <p className="mt-8 text-sm text-zinc-400">{t('hero.note')}</p>
        </div>
      </section>

      {/* Vidéo de démo */}
      <section id="video" className="py-20 px-4 sm:px-6 lg:px-8 bg-zinc-900 text-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="inline-block mb-4 px-4 py-1.5 rounded-full border border-amber-500/40 text-amber-400 text-sm font-semibold tracking-wide uppercase">
              {t('video.kicker')}
            </p>
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">{t('video.title')}</h2>
            <p className="text-xl text-zinc-300 max-w-3xl mx-auto">{t('video.subtitle')}</p>
          </div>
          <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50 bg-black">
            <video
              key={videoSrc}
              className="w-full aspect-video"
              controls
              playsInline
              preload="metadata"
              poster={videoPoster}
              aria-label={t('video.caption')}
            >
              <source src={videoSrc} type="video/mp4" />
            </video>
          </div>
          <p className="mt-4 text-center text-sm text-zinc-400">{t('video.note')}</p>
        </div>
      </section>

      {/* 3 scénarios de démo */}
      <section id="scenarios" className="py-20 px-4 sm:px-6 lg:px-8 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">{t('scenarios.title')}</h2>
            <p className="text-xl text-zinc-600 max-w-2xl mx-auto">{t('scenarios.subtitle')}</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {scenarios.map(({ icon: Icon, title, text, href }, i) => (
              <div key={href} className="flex flex-col p-8 rounded-2xl border-2 border-zinc-100 hover:border-amber-400 transition-colors">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-xl bg-zinc-950 text-amber-400 flex items-center justify-center">
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className="text-sm font-bold text-zinc-400">{i + 1}/3</span>
                </div>
                <h3 className="text-2xl font-bold mb-2">{title}</h3>
                <p className="text-zinc-600 text-lg mb-8 flex-1">{text}</p>
                {/* <a> classique : la route API pose le cookie démo puis redirige vers l'écran du scénario */}
                <a
                  href={href}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-zinc-950 text-white font-bold hover:bg-zinc-800 transition-colors group"
                >
                  <Play className="w-4 h-4" />
                  {t('scenarios.try')}
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 rtl:rotate-180 transition-transform" />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Douleur */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-zinc-50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-black tracking-tight text-center mb-14">{t('pain.title')}</h2>
          <ul className="space-y-4">
            {painItems.map(item => (
              <li key={item} className="flex items-start gap-4 bg-white border border-zinc-200 rounded-2xl p-5 text-lg">
                <span className="mt-0.5 shrink-0 w-7 h-7 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
                  <X className="w-4 h-4" />
                </span>
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-12 text-center text-2xl md:text-3xl font-extrabold">{t('pain.punch')}</p>
        </div>
      </section>

      {/* Solution */}
      <section className="py-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4">{t('solution.title')}</h2>
            <p className="text-xl text-zinc-600 max-w-2xl mx-auto">{t('solution.subtitle')}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {benefits.map((Icon, i) => (
              <div key={i} className="p-8 rounded-2xl border-2 border-zinc-100 hover:border-amber-400 transition-colors">
                <div className="w-12 h-12 rounded-xl bg-zinc-950 text-amber-400 flex items-center justify-center mb-5">
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="text-2xl font-bold mb-2">{t(`solution.items.${i}.title`)}</h3>
                <p className="text-zinc-600 text-lg">{t(`solution.items.${i}.text`)}</p>
              </div>
            ))}
          </div>
          <p className="mt-14 text-center text-2xl md:text-3xl font-extrabold">{t('solution.punch')}</p>
        </div>
      </section>

      {/* Tunisie */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-zinc-950 text-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-4xl md:text-5xl font-black tracking-tight text-center mb-14">{t('local.title')}</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {localItems.map(item => (
              <div key={item} className="flex items-center gap-3 p-5 rounded-xl bg-white/5 border border-white/10 text-lg">
                <Check className="w-6 h-6 text-amber-400 shrink-0" />
                {item}
              </div>
            ))}
          </div>
          <div className="mt-16 text-center">
            <h3 className="text-2xl md:text-3xl font-bold mb-3">{t('modules.title')}</h3>
            <p className="text-zinc-400 text-lg max-w-2xl mx-auto">{t('modules.text')}</p>
          </div>
        </div>
      </section>

      {/* Démo */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-amber-400">
        <div className="max-w-4xl mx-auto text-center text-zinc-950">
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-6">{t('demo.title')}</h2>
          <p className="text-xl mb-10 max-w-2xl mx-auto">{t('demo.text')}</p>
          <a href={demoHref} className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-zinc-950 text-white font-bold text-lg hover:bg-zinc-800 transition-colors">
            <Play className="w-5 h-5" />
            {t('demo.button')}
          </a>
        </div>
      </section>

      {/* Appel final */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-zinc-950 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-6xl font-black tracking-tight mb-6">{t('final.title')}</h2>
          <p className="text-xl text-zinc-300 mb-10">{t('final.text')}</p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link href="/register" className={btnPrimary}>
              {t('final.trial')}
              <ArrowRight className="w-5 h-5 rtl:rotate-180" />
            </Link>
            <a href={mailto} className={btnGhost}>
              <CalendarCheck className="w-5 h-5" />
              {t('final.meeting')}
            </a>
          </div>
        </div>
      </section>

      <footer className="bg-black text-zinc-500 py-10 px-4 text-sm">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-white font-bold">
            <Layers className="w-5 h-5 text-amber-500" /> BelloSuite
          </div>
          <p>{t('footer.rights')}</p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link href="/terms" className="hover:text-white">{tl('terms')}</Link>
            <Link href="/privacy" className="hover:text-white">{tl('privacy')}</Link>
            <a href={mailto} className="hover:text-white">{t('footer.contact')}</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
