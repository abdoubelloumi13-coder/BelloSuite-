import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { signInvoice } from '@/lib/einvoice/service'

export const runtime = 'nodejs'

const schema = z.object({
  mode: z.enum(['local', 'digigo-mock']),
  otp: z.string().regex(/^\d{6}$/, 'Code OTP à 6 chiffres').optional(),
  tenantId: z.string().optional(),
})

// POST /api/commercial/invoices/[id]/einvoice/sign — signature XAdES-B SIMULÉE
// body : { mode: 'local' | 'digigo-mock', otp?: '123456' }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const data = parseBody(schema, body)
    if (data instanceof NextResponse) return data
    const ctx = await getApiContext(req, data.tenantId ?? new URL(req.url).searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    if (data.mode === 'digigo-mock' && !data.otp) {
      return NextResponse.json({ error: 'Code OTP à 6 chiffres requis (DigiGo simulé)', code: 'OTP_REQUIRED' }, { status: 400 })
    }
    return NextResponse.json(await signInvoice(ctx.tenantId, id, { mode: data.mode, otp: data.otp }))
  } catch (err) {
    return handleApiError(err, 'POST einvoice sign')
  }
}
