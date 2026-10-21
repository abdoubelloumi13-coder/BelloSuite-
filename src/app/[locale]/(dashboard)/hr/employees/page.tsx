'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/i18n/routing'
import { Upload, Plus } from 'lucide-react'
import { EmployeesTable } from './components/EmployeesTable'
import { EmployeeFormModal } from './components/EmployeeFormModal'
import { useSession } from '@/hooks/useSession'
import { useTranslations } from 'next-intl'

export default function EmployeesPage() {
  const t = useTranslations('HR.employees')
  const { tenantId } = useSession()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)


  useEffect(() => {
    // If we have a tenantId or none defaults
    // Since BelloSuite uses session logic, let's fetch unconditionally if tenantId is found or use a dummy tenant if not set
    // In many of these setups, tenantId may be mock initially if the user is testing
    const currentTenant = tenantId
    fetchEmployees(currentTenant)
  }, [tenantId])

  // /hr/employees?new=1 (raccourci « Nouvel employé ») : ouvre le formulaire de création
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('new') !== '1') return
    const id = setTimeout(() => {
      setShowModal(true)
      window.history.replaceState(null, '', window.location.pathname)
    }, 0)
    return () => clearTimeout(id)
  }, [])

  async function fetchEmployees(currentTenant: string) {
    setLoading(true)
    try {
      const res = await fetch(`/api/hr/employees`)
      if (res.ok) {
        const data = await res.json()
        setEmployees(data)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-stone-900 tracking-tight">{t('title')}</h1>
          <p className="text-stone-500 font-medium text-sm mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/hr/employees/import"
            className="flex items-center gap-2 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-xl font-bold text-sm transition-all shadow-sm"
          >
            <Upload className="w-4 h-4" /> {t('import_csv')}
          </Link>
          <button 
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-sm transition-all shadow-sm shadow-teal-500/20"
          >
            <Plus className="w-4 h-4" /> {t('new')}
          </button>
        </div>
      </div>

      <EmployeesTable 
        employees={employees} 
        loading={loading} 
        onEditEmployee={(emp) => console.log('Edit', emp)} 
      />

      {showModal && (
        <EmployeeFormModal
          tenantId={tenantId}
          onClose={() => setShowModal(false)}
          onSave={() => {
            setShowModal(false)
            fetchEmployees(tenantId)
          }}
        />
      )}
    </div>
  )
}