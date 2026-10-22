/**
 * Réponses d'erreur sans fuite d'information interne (audit M4) : seuls les messages métier (BusinessError)
 * sont renvoyés au client ; tout le reste (messages Prisma : tables, colonnes, contraintes…) reste dans les logs.
 */
import { NextResponse } from 'next/server'
import { BusinessError } from '@/lib/errors'

export function safeErrorResponse(
  error: unknown,
  operation: string,
  fallback = 'Erreur serveur',
  known: Record<string, { message: string; status: number }> = {}
): NextResponse {
  console.error(`${operation} error:`, error)
  if (error instanceof BusinessError) {
    return NextResponse.json({ ...(error.details ?? {}), error: error.message }, { status: error.statusCode })
  }
  const msg = (error as { message?: unknown })?.message
  if (typeof msg === 'string' && known[msg]) {
    return NextResponse.json({ error: known[msg].message }, { status: known[msg].status })
  }
  return NextResponse.json({ error: fallback }, { status: 500 })
}
