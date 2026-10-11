'use client'

import { 
  Plus, 
  FileText, 
  Users, 
  Package, 
  ShoppingCart,
  Upload,
  ArrowRight,
  TrendingUp,
  Receipt,
  Building,
  ScanLine,
  Landmark
} from 'lucide-react'
import { Link } from '@/i18n/routing'
import { useTranslations } from 'next-intl'

interface QuickAction {
  label: string
  href: string
  icon: React.ElementType
  color: string
}

interface QuickActionsProps {
  userRole?: string
}

export function QuickActions({ userRole = 'USER' }: QuickActionsProps) {
  const t = useTranslations('Dashboard.quick_actions')
  const isAdmin = userRole === 'ADMIN' || userRole === 'SUPER_ADMIN'

  const actions: QuickAction[] = [
    {
      label: t('scan_document'),
      href: '/commercial/scan',
      icon: ScanLine,
      color: 'teal'
    },
    {
      label: t('fiscal_assistant'),
      href: '/assistant-fiscal',
      icon: Landmark,
      color: 'blue'
    },
    { 
      label: t('new_invoice'), 
      href: '/commercial/documents/new?type=INVOICE', 
      icon: Receipt,
      color: 'emerald'
    },
    { 
      label: t('new_client'), 
      href: '/commercial/clients/new', 
      icon: ShoppingCart,
      color: 'blue'
    },
    { 
      label: t('new_product'), 
      href: '/stock/products/new', 
      icon: Package,
      color: 'amber'
    },
    { 
      label: t('import'), 
      href: '/stock/import', 
      icon: Upload,
      color: 'purple'
    },
  ]

  const adminActions: QuickAction[] = [
    { 
      label: t('new_employee'), 
      href: '/hr/employees/new', 
      icon: Users,
      color: 'teal'
    },
    { 
      label: t('estimate'), 
      href: '/commercial/documents/new?type=ESTIMATE', 
      icon: FileText,
      color: 'orange'
    },
  ]

  const displayActions = isAdmin ? [...actions, ...adminActions] : actions

  return (
    <div className="bg-white rounded-[2rem] p-6 border border-stone-200 shadow-sm">
      <div className="flex items-center gap-2 mb-6">
        <TrendingUp className="w-5 h-5 text-emerald-600" />
        <h3 className="font-black text-stone-900">{t('title')}</h3>
      </div>
      
      <div className="grid grid-cols-2 gap-3">
        {displayActions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className={`flex items-center gap-3 p-4 rounded-2xl border border-stone-100 hover:border-stone-300 hover:shadow-md transition-all group`}
          >
            <div className={`p-2.5 rounded-xl bg-${action.color}-50 text-${action.color}-600`}>
              <action.icon className="w-4 h-4" />
            </div>
            <span className="text-sm font-semibold text-stone-700 group-hover:text-stone-900">
              {action.label}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}