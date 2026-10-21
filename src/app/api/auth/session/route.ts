import { NextResponse } from 'next/server'
import { getLiveSession } from '@/lib/api-auth'

// Session revalidée en base : rôle actuel, compte actif, entreprise non suspendue.
export async function GET() {
  const session = await getLiveSession()
  if (!session) return NextResponse.json(null, { status: 401 })
  return NextResponse.json(session)
}
