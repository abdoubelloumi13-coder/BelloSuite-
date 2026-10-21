import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { testASPConnection } from '@/lib/ttn-asp'

// POST /api/commercial/asp-config/test
export async function POST(req: Request) {
  const ctx = await requireTenant(req)
  if (ctx instanceof NextResponse) return ctx
  const accessDenied = requireAccess(ctx, 'settings:write')
  if (accessDenied) return accessDenied
  try {
    const body = await req.json()
    const result = await testASPConnection({
      provider: body.provider || 'ttnhub',
      apiKey: body.apiKey || '',
      apiSecret: body.apiSecret || '',
      isActive: true,
    } as any)
    return NextResponse.json(result)
  } catch (e) {
    console.error(e)
    return NextResponse.json({ ok: false, message: 'Connection test failed' }, { status: 500 })
  }
}
