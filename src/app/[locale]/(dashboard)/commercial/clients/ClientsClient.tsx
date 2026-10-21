'use client'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Plus, Search, User, Mail, Phone, MapPin, MoreVertical, Edit, Trash2, Building2 } from 'lucide-react'
import ClientModal from '@/components/commercial/ClientModal'

export default function ClientsClient({ initialClients, tenantId }: { initialClients: any[], tenantId: string }) {
  const t = useTranslations('Commercial.Clients')
  const locale = useLocale()
  const [clients, setClients] = useState<any[]>(initialClients)
  const [loading, setLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedClient, setSelectedClient] = useState<any>(null)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    setClients(initialClients)
  }, [initialClients])

  // Lien direct « Modifier la fiche client » (ex. depuis la facture électronique) : ?edit=<clientId>
  useEffect(() => {
    const editId = new URLSearchParams(window.location.search).get('edit')
    if (!editId) return
    const c = initialClients.find(x => x.id === editId)
    if (c) { setSelectedClient(c); setIsModalOpen(true) }
  }, [initialClients])

  const fetchClients = async () => {
    try {
      const res = await fetch(`/api/commercial/clients`)
      const data = await res.json()
      setClients(data)
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (confirm(t('delete_confirm'))) {
      await fetch(`/api/commercial/clients/${id}`, { method: 'DELETE' })
      fetchClients()
    }
  }

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.matriculeFiscal?.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div className="p-8 space-y-8 max-w-7xl mx-auto min-h-screen bg-transparent pt-0 text-start">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
           <h1 className="text-4xl font-black text-stone-900 dark:text-white tracking-tighter flex items-center gap-3 italic">
              {t('title')}
           </h1>
           <p className="text-stone-500 dark:text-zinc-400 mt-2 font-medium">{t('description')}</p>
        </div>
        <button 
          onClick={() => { setSelectedClient(null); setIsModalOpen(true); }}
          className="flex items-center gap-2 px-6 py-4 bg-teal-600 hover:bg-teal-500 text-white rounded-2xl transition-all shadow-lg shadow-teal-600/20 font-black uppercase tracking-widest text-xs"
        >
          <Plus className="w-5 h-5" /> {t('new')}
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative group max-w-md">
        <Search className="w-5 h-5 absolute inset-inline-start-4 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-teal-500 transition-colors" />
        <input 
          placeholder={t('search')}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full bg-white dark:bg-zinc-900/40 backdrop-blur-xl border border-stone-200 dark:border-zinc-800 focus:border-teal-500/50 rounded-2xl ps-12 pe-4 py-4 text-stone-900 dark:text-white outline-none transition-all shadow-sm text-start"
        />
      </div>

      {/* Clients Grid/Table Area */}
      <div className="bg-white dark:bg-zinc-900/40 backdrop-blur-xl border border-stone-200 dark:border-zinc-800 rounded-[2.5rem] overflow-hidden shadow-2xl shadow-teal-500/5 transition-all">
        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse">
            <thead>
              <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-800/20">
                <th className="px-8 py-6 text-start text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('client')}</th>
                <th className="px-6 py-6 text-start text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('matricule_fiscal')}</th>
                <th className="px-6 py-6 text-start text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('contact')}</th>
                <th className="px-6 py-6 text-start text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('localization')}</th>
                <th className="px-8 py-6 text-end text-[10px] font-black text-stone-500 dark:text-zinc-500 uppercase tracking-widest">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/30">
              {loading ? (
                <tr><td colSpan={5} className="px-8 py-20 text-center text-stone-400 dark:text-zinc-600 font-bold uppercase tracking-widest text-xs">{t('loading')}</td></tr>
              ) : filteredClients.length === 0 ? (
                <tr><td colSpan={5} className="px-8 py-20 text-center text-stone-400 dark:text-zinc-600 font-bold uppercase tracking-widest text-xs">{t('no_found')}</td></tr>
              ) : filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-stone-50/50 dark:hover:bg-zinc-800/30 transition-all group">
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                       <div className="w-12 h-12 rounded-2xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-white border border-stone-200 dark:border-zinc-700/50 group-hover:border-teal-500/30 transition-all">
                          <Building2 className="w-6 h-6 text-stone-400 dark:text-zinc-500 group-hover:text-teal-500" />
                       </div>
                       <div>
                          <p className="font-bold text-stone-900 dark:text-white tracking-tight text-base">{client.name}</p>
                          <p className="text-[10px] font-black text-stone-400 dark:text-zinc-600 uppercase tracking-widest font-mono">{client.code}</p>
                       </div>
                    </div>
                  </td>
                  <td className="px-6 py-6 font-mono text-stone-600 dark:text-zinc-300 text-xs font-bold text-start">{client.matriculeFiscal || '---'}</td>
                  <td className="px-6 py-6 text-start">
                    <div className="space-y-1">
                       <p className="text-stone-600 dark:text-zinc-300 text-sm font-medium flex items-center gap-2"><Mail className="w-3 h-3 text-stone-400 dark:text-zinc-500" /> {client.email || '---'}</p>
                       <p className="text-[10px] text-stone-500 dark:text-zinc-500 font-bold flex items-center gap-2"><Phone className="w-3 h-3 text-teal-500/50" /> {client.phone || '---'}</p>
                    </div>
                  </td>
                  <td className="px-6 py-6 text-start">
                    <div className="flex items-center gap-2">
                       <MapPin className="w-4 h-4 text-teal-500/30" />
                       <span className="text-stone-500 dark:text-zinc-400 text-sm font-medium">{client.city || 'Tunis'}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-end">
                    <div className="flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-all">
                      <button 
                        onClick={() => { setSelectedClient(client); setIsModalOpen(true); }}
                        className="p-3 bg-stone-50 dark:bg-zinc-800 hover:bg-teal-500/10 text-stone-400 dark:text-zinc-500 hover:text-teal-600 dark:hover:text-teal-400 rounded-xl transition-all border border-transparent hover:border-teal-500/10"
                      >
                         <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleDelete(client.id)}
                        className="p-3 bg-stone-50 dark:bg-zinc-800 hover:bg-red-500/10 text-stone-400 dark:text-zinc-500 hover:text-red-600 dark:hover:text-red-400 rounded-xl transition-all border border-transparent hover:border-red-500/10"
                      >
                         <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ClientModal 
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={() => fetchClients()}
        tenantId={tenantId}
        client={selectedClient}
      />
    </div>
  )
}
