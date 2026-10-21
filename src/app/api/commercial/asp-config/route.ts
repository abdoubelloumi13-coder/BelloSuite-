import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { encryptAspSecrets, EncryptionKeyError } from '@/lib/secret-crypto'

type StoredConfig = {
  id: string
  provider: string
  isActive: boolean
  sftpEndpoint: string | null
  sftpUsername: string | null
  apiKey: string
  apiSecret: string
  sftpPassword: string | null
  webhookSecret: string | null
}

/** Réponse publique : jamais de secret, seulement des indicateurs « configuré ». */
function publicView(config: StoredConfig) {
  return {
    id: config.id,
    provider: config.provider,
    isActive: config.isActive,
    sftpEndpoint: config.sftpEndpoint,
    sftpUsername: config.sftpUsername,
    hasApiKey: !!config.apiKey,
    hasApiSecret: !!config.apiSecret,
    hasSftpPassword: !!config.sftpPassword,
    webhookSecret: config.webhookSecret ? '***configured***' : '',
  }
}

// GET /api/commercial/asp-config
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const ctx = await requireTenant(req, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'settings:write')
    if (accessDenied) return accessDenied

    const config = await prisma.aSPConfiguration.findUnique({ where: { tenantId: ctx.tenantId } })
    if (!config) return NextResponse.json(null, { status: 200 }) // null = non configuré
    return NextResponse.json(publicView(config))
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/commercial/asp-config
// Secrets (apiKey, apiSecret, sftpPassword, webhookSecret) chiffrés AES-256-GCM avant écriture.
// Un secret laissé vide à la mise à jour conserve la valeur existante (le GET ne renvoie jamais les secrets).
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { tenantId: requestedTenantId, provider, apiKey, apiSecret, sftpUsername, sftpPassword, sftpEndpoint, webhookSecret, isActive } = body
    const ctx = await requireTenant(req, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'settings:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ error: 'provider required' }, { status: 400 })
    }

    const str = (v: unknown) => (typeof v === 'string' ? v : '')
    const newSecrets: Record<string, string> = {}
    for (const [k, v] of Object.entries({ apiKey, apiSecret, sftpPassword, webhookSecret })) {
      // '***configured***' = valeur masquée renvoyée par le GET, jamais un vrai secret
      if (str(v) && str(v) !== '***configured***') newSecrets[k] = str(v)
    }
    const encrypted = encryptAspSecrets(newSecrets)

    const config = await prisma.aSPConfiguration.upsert({
      where: { tenantId },
      create: {
        tenantId,
        provider,
        apiKey: encrypted.apiKey ?? '',
        apiSecret: encrypted.apiSecret ?? '',
        sftpUsername: str(sftpUsername),
        sftpPassword: encrypted.sftpPassword ?? '',
        sftpEndpoint: str(sftpEndpoint),
        webhookSecret: encrypted.webhookSecret ?? '',
        isActive: isActive === true,
      },
      update: {
        provider,
        ...encrypted,
        sftpUsername: str(sftpUsername),
        sftpEndpoint: str(sftpEndpoint),
        isActive: isActive === true,
      },
    })

    return NextResponse.json(publicView(config))
  } catch (e) {
    if (e instanceof EncryptionKeyError) {
      console.error('[asp-config] ' + e.message)
      return NextResponse.json({ error: 'Configuration serveur invalide : ASP_ENCRYPTION_KEY manquante' }, { status: 500 })
    }
    console.error(e)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
