'use client'

import { useState, useEffect } from 'react'
import { X, Users, FileText, History, Save, Trash2, Edit2, Plus, Search, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import SmartInput from '@/components/ui/SmartInput'
import type { Suggestion } from '@/components/ui/SmartInput'

interface TenantDetailModalProps {
  isOpen: boolean
  onClose: () => void
  tenantId: string
  tenantName: string
  onRefresh: () => void
}

export default function TenantDetailModal({ isOpen, onClose, tenantId, tenantName, onRefresh }: TenantDetailModalProps) {
  const t = useTranslations('SuperAdmin.tenantDetail')
  const [activeTab, setActiveTab] = useState<'members' | 'notes' | 'audit'>('members')
  const [members, setMembers] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [newNote, setNewNote] = useState('')

  // Load all data on open
  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    Promise.all([
      fetch(`/api/super-admin/tenants/${tenantId}/members`).then(r => r.ok ? r.json() : { users: [] }),
      fetch(`/api/super-admin/tenants/${tenantId}/notes`).then(r => r.ok ? r.json() : []),
      fetch(`/api/super-admin/audit-logs?tenantId=${tenantId}&limit=30`).then(r => r.ok ? r.json() : { logs: [] }),
    ])
      .then(([m, n, a]) => {
        setMembers(m.users || [])
        setNotes(n)
        setAuditLogs(a.logs || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [isOpen, tenantId])

  const handleAddNote = async () => {
    if (!newNote.trim()) return
    await fetch(`/api/super-admin/tenants/${tenantId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: newNote.trim() }),
    })
    setNewNote('')
    onRefresh()
  }

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm(t('confirm_delete_note'))) return
    await fetch(`/api/super-admin/tenants/${tenantId}/notes/${noteId}`, { method: 'DELETE' })
    onRefresh()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-8 py-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div>
            <h2 className="text-2xl font-black text-zinc-900">{tenantName}</h2>
            <p className="text-sm font-medium text-zinc-500 mt-1">{t('subtitle')}</p>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 rounded-full transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-100 bg-zinc-50/50">
          {(['members', 'notes', 'audit'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-xs font-black uppercase tracking-widest border-b-2 transition-all ${
                activeTab === tab
                  ? 'border-emerald-500 text-emerald-600 bg-emerald-500/5'
                  : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
              }`}
            >
              {tab === 'members' ? t('tab_members') : tab === 'notes' ? t('tab_notes') : t('tab_audit')}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {activeTab === 'members' && (
            <div className="space-y-4">
              {loading ? (
                <div className="text-center py-12 text-zinc-500">Chargement...</div>
              ) : members.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                  <Users className="w-12 h-12 mx-auto mb-4 text-zinc-300" />
                  <p className="font-medium">{t('no_members')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-200">
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('user')}</th>
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('role')}</th>
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('status')}</th>
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('created_at')}</th>
                        <th className="px-4 py-3 text-end text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {members.map((u: any) => (
                        <tr key={u.id} className="hover:bg-zinc-50">
                          <td className="px-4 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500/20 to-zinc-100 flex items-center justify-center font-black text-blue-600 border border-zinc-200 text-sm">
                                {(u.firstName?.charAt(0) || u.email?.charAt(0)).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-zinc-900 text-sm">{u.firstName || ''} {u.lastName || ''}</p>
                                <p className="text-xs text-zinc-500">{u.email}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase ${
                              u.role === 'ADMIN' ? 'bg-amber-500/10 text-amber-400' : 'bg-zinc-100 text-zinc-500'
                            }`}>
                              {u.role === 'ADMIN' ? t('role_admin') : t('role_user')}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-black uppercase ${
                              u.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                            }`}>
                              {u.isActive ? '●' : '○'} {u.isActive ? t('active') : t('inactive')}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-xs text-zinc-500">
                            {new Date(u.createdAt).toLocaleDateString('fr-TN')}
                          </td>
                          <td className="px-4 py-4 text-end">
                            <button className="text-zinc-400 hover:text-emerald-500 px-2 py-1 rounded-lg hover:bg-emerald-500/5 transition-colors" title={t('view_details')}>
                              <Search className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'notes' && (
            <div className="space-y-6">
              <div className="bg-zinc-50 rounded-2xl p-6">
                <label className="block text-sm font-semibold text-zinc-700 mb-2">{t('new_note')}</label>
                <textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder={t('note_placeholder')}
                  rows={3}
                  className="w-full px-4 py-3 bg-white border border-zinc-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 resize-none"
                />
                <button
                  onClick={handleAddNote}
                  disabled={!newNote.trim()}
                  className="mt-3 flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white font-bold rounded-xl text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Save className="w-4 h-4" /> {t('add_note')}
                </button>
              </div>

              {loading ? (
                <div className="text-center py-12 text-zinc-500">Chargement...</div>
              ) : notes.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                  <FileText className="w-12 h-12 mx-auto mb-4 text-zinc-300" />
                  <p className="font-medium">{t('no_notes')}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {notes.map((n: any) => (
                    <div key={n.id} className="bg-zinc-50 rounded-2xl p-4 border border-zinc-100">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-zinc-900 text-sm leading-relaxed whitespace-pre-wrap">{n.content}</p>
                          <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
                            <span className="font-medium">{n.author?.firstName} {n.author?.lastName}</span>
                            <span>•</span>
                            <span>{new Date(n.createdAt).toLocaleString('fr-TN')}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDeleteNote(n.id)}
                          className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-colors shrink-0"
                          title={t('delete_note')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'audit' && (
            <div>
              {loading ? (
                <div className="text-center py-12 text-zinc-500">Chargement...</div>
              ) : auditLogs.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                  <History className="w-12 h-12 mx-auto mb-4 text-zinc-300" />
                  <p className="font-medium">{t('no_audit_logs')}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-zinc-200">
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('action')}</th>
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('target')}</th>
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('admin')}</th>
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('date')}</th>
                        <th className="px-4 py-3 text-start text-[10px] font-black uppercase tracking-widest text-zinc-500">{t('details')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {auditLogs.map((l: any) => (
                        <tr key={l.id} className="hover:bg-zinc-50">
                          <td className="px-4 py-3">
                            <span className="px-2.5 py-1 rounded-lg text-[10px] font-black uppercase bg-emerald-500/10 text-emerald-600">
                              {l.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-zinc-700">
                            {l.target ? `${l.target} (${l.targetId?.slice(0, 8)}...)` : '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-zinc-700">
                            {l.admin?.firstName} {l.admin?.lastName} ({l.admin?.email})
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-500">
                            {new Date(l.createdAt).toLocaleString('fr-TN')}
                          </td>
                          <td className="px-4 py-3 text-xs text-zinc-500 font-mono max-w-xs truncate">
                            {l.details ? JSON.stringify(l.details) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}