import { redirect } from 'next/navigation'
import { getLiveSession } from '@/lib/api-auth'
import Sidebar from '@/components/layout/Sidebar'
import { SessionProvider } from '@/components/providers/SessionProvider'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getLiveSession()

  if (!session) redirect('/login')
  if (session.role === 'SUPER_ADMIN') redirect('/super-admin')
  if (!session.tenantId) redirect('/onboarding')

  return (
    <SessionProvider initialSession={session}>
      <div className="flex bg-zinc-950 min-h-screen font-sans">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-stone-50 rounded-s-[40px] shadow-[inset_0_35px_60px_-15px_rgba(0,0,0,0.3)] relative z-10 transition-all duration-700 ease-in-out border-s border-zinc-800/50">
          <div className="p-8 pb-16">{children}</div>
        </main>
      </div>
    </SessionProvider>
  )
}