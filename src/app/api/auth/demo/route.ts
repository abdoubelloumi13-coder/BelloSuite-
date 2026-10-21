import { NextRequest, NextResponse } from 'next/server'
import { createSessionCookie } from '@/lib/session'
import { prisma } from '@/lib/db'
import { routing } from '@/i18n/routing'
import { safeDemoNext } from '@/lib/demo-redirect'
import { DEMO_EMAIL } from '@/lib/session-guard'
import { enforceRateLimits, clientIp } from '@/lib/rate-limit-persistent'

export const runtime = 'nodejs'

/** Session démo courte : 2 h. */
const DEMO_SESSION_SECONDS = 2 * 60 * 60

export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('locale') || routing.defaultLocale
  const locale = (routing.locales as readonly string[]).includes(requested) ? requested : routing.defaultLocale
  // Page d'arrivée optionnelle (scénarios de démo de la landing) : liste blanche stricte.
  const next = safeDemoNext(req.nextUrl.searchParams.get('next'))

  try {
    const limited = await enforceRateLimits([{ key: `demo:ip:${clientIp(req)}`, max: 20, windowSeconds: 60 * 60 }])
    if (limited) return limited
    // Lecture seule : ne jamais créer de compte ici (le compte démo vient de prisma/seed-demo.ts).
    const user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })
    if (!user || !user.isActive || !user.tenantId) {
      return NextResponse.json(
        { error: 'Démo non disponible : lancez npm run db:seed-demo' },
        { status: 503 }
      )
    }

    // SÉCURITÉ : jamais ADMIN en démo publique (session partagée par tous les visiteurs).
    // Rôle USER + drapeau demo : lecture seule sur paie/compta/paramètres, aucun envoi d'e-mail/WhatsApp,
    // IA plafonnée (voir session-guard / rbac). Le rôle est de toute façon re-plafonné à chaque requête.
    await createSessionCookie({
      id: user.id,
      email: user.email,
      role: 'USER',
      tenantId: user.tenantId,
      firstName: user.firstName || 'Démo',
      demo: true,
    }, { expiresInSeconds: DEMO_SESSION_SECONDS })

    return NextResponse.redirect(new URL(`/${locale}${next}`, req.url))
  } catch (err) {
    console.error('Demo login error:', err)
    return NextResponse.json({ error: 'Erreur lors de la connexion démo' }, { status: 500 })
  }
}
