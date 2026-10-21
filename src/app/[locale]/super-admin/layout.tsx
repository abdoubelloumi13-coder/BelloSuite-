import { redirect } from 'next/navigation'
import { getLiveSession } from '@/lib/api-auth'

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getLiveSession()

  if (!session) redirect('/login')
  if (session.role !== 'SUPER_ADMIN') redirect('/dashboard')

  return (
    <div className="min-h-screen bg-zinc-950">
      {children}
    </div>
  )
}