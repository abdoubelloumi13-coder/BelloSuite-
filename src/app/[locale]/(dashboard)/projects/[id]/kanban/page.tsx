'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Plus, X, GripVertical, MessageSquare, Calendar, Clock, CheckCircle, ChevronLeft, Tag, Users } from 'lucide-react'
import { useTranslations, useLocale } from 'next-intl'
import { readApiError } from '@/lib/client-errors'

const PRIORITY_META: Record<string, { cls: string }> = {
  low:      { cls: 'bg-zinc-700 text-zinc-400' },
  medium:   { cls: 'bg-amber-500/20 text-amber-400' },
  high:     { cls: 'bg-red-500/20 text-red-400' },
  critical: { cls: 'bg-violet-500/20 text-violet-400' },
}

export default function ProjectKanbanPage() {
  const t = useTranslations('Projects.kanban')
  const locale = useLocale()
  const [columns, setColumns] = useState<any[]>([])
  const [tasks, setTasks] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const params = useParams<{ id: string }>()
  const projectId = params?.id ?? ''
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingTask, setEditingTask] = useState<any>(null)
  const [draggingTask, setDraggingTask] = useState<any>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchBoard = useCallback(async () => {
    if (!projectId) return
    try {
      const res = await fetch(`/api/projects/${projectId}`)
      if (!res.ok) { setError(await readApiError(res, locale)); return }
      const data = await res.json()
      const cols = data.columns || []
      setColumns(cols)
      // L'API renvoie les tâches imbriquées dans chaque colonne (columns[].tasks)
      setTasks(Array.isArray(data.tasks) ? data.tasks : cols.flatMap((c: any) => (c.tasks || []).map((tk: any) => ({ ...tk, columnId: tk.columnId ?? c.id }))))
      setMembers(data.members || [])
      setError(null)
    } catch {
      setError(t('load_error'))
    } finally {
      setLoading(false)
    }
  }, [projectId, locale, t])

  useEffect(() => { fetchBoard() }, [fetchBoard])

  const handleDrop = async (e: React.DragEvent, columnId: string) => {
    e.preventDefault()
    setDragOverColumn(null)
    if (!draggingTask) return
    try {
      const res = await fetch(`/api/projects/${projectId}/move-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: draggingTask.id, targetColumnId: columnId })
      })
      if (!res.ok) setError(await readApiError(res, locale))
    } catch {
      setError(t('save_error'))
    }
    setDraggingTask(null)
    fetchBoard()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-teal-500/30 border-t-teal-500 rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="flex flex-col h-full px-4 sm:px-8 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => history.back()} className="p-2 hover:bg-stone-100 rounded-xl text-stone-500 transition-colors">
            <ChevronLeft className="w-5 h-5 rtl:rotate-180" />
          </button>
          <div>
            <h2 className="text-xl font-black text-stone-900">{t('title')}</h2>
            <p className="text-xs text-zinc-500">{t('summary', { tasks: tasks.length, columns: columns.length })}</p>
          </div>
        </div>
        <button
          onClick={() => { setEditingTask({ columnId: columns[0]?.id }); setShowModal(true) }}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-bold text-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> {t('new_task')}
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-medium flex items-center justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="×"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-6 flex-1">
        {columns.map(col => {
          const colTasks = tasks.filter(t => t.columnId === col.id)
          return (
            <div key={col.id}
              className={`flex-shrink-0 w-72 bg-zinc-900/50 rounded-2xl flex flex-col min-h-[400px] transition-all ${
                dragOverColumn === col.id ? 'ring-2 ring-teal-500/50 bg-teal-500/5' : ''
              }`}
              onDragOver={e => { e.preventDefault(); setDragOverColumn(col.id) }}
              onDragLeave={() => setDragOverColumn(null)}
              onDrop={e => handleDrop(e, col.id)}
            >
              {/* Column Header */}
              <div className="flex items-center justify-between p-4 border-b border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: col.color || '#6366f1' }} />
                  <span className="font-black text-xs text-zinc-300 uppercase tracking-widest">{col.name}</span>
                  <span className="text-xs font-bold text-zinc-600 bg-zinc-800 px-2 py-0.5 rounded-full">{colTasks.length}</span>
                </div>
                <button onClick={() => { setEditingTask({ _type: 'add_task', columnId: col.id }); setShowModal(true) }}
                  className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-600 hover:text-zinc-400">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Tasks */}
              <div className="flex-1 p-3 space-y-3 overflow-y-auto">
                {colTasks.map(task => (
                  <div key={task.id}
                    draggable
                    onDragStart={e => setDraggingTask(task)}
                    onDragEnd={() => setDraggingTask(null)}
                    onClick={() => { setEditingTask(task); setShowModal(true) }}
                    className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl p-4 cursor-pointer hover:border-zinc-600 hover:bg-zinc-800 transition-all group"
                  >
                    {task.labels?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {task.labels.slice(0, 3).map((l: any, i: number) => (
                          <span key={i} className="text-[10px] font-black px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300">{l.name}</span>
                        ))}
                      </div>
                    )}
                    <p className="text-sm font-bold text-zinc-200 mb-2 line-clamp-2">{task.title}</p>
                    <div className="flex items-center gap-3 text-zinc-500">
                      {task.priority && (
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${PRIORITY_META[task.priority]?.cls}`}>
                          {PRIORITY_META[task.priority] ? t(`priorities.${task.priority}`) : task.priority}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className={`text-[10px] font-bold flex items-center gap-1 ${new Date(task.dueDate) < new Date() ? 'text-red-400' : 'text-zinc-500'}`}>
                          <Clock className="w-3 h-3" />
                          {new Date(task.dueDate).toLocaleDateString(`${locale}-TN`, { day: 'numeric', month: 'short' })}
                        </span>
                      )}
                      {task.assignee && (
                        <div className="w-5 h-5 rounded-full bg-teal-600 flex items-center justify-center text-[9px] font-black text-white ms-auto"
                          title={task.assignee.email}>
                          {task.assignee.firstName?.[0] || '?'}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-zinc-700/30">
                      {task.checklist?.length > 0 && (
                        <span className="text-[10px] font-bold text-zinc-500 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          {task.checklist.filter((i: any) => i.checked).length}/{task.checklist.length}
                        </span>
                      )}
                      {task.comments?.length > 0 && (
                        <span className="text-[10px] font-bold text-zinc-500 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />{task.comments.length}
                        </span>
                      )}
                      <GripVertical className="w-3 h-3 text-zinc-600 ms-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ))}
              </div>

              {/* Add task in column */}
              <button
                onClick={() => { setEditingTask({ _type: 'add_task', columnId: col.id }); setShowModal(true) }}
                className="m-3 mt-0 flex items-center justify-center gap-2 py-2.5 bg-zinc-800/30 hover:bg-zinc-800/60 text-zinc-500 hover:text-zinc-300 rounded-xl text-xs font-bold transition-all border border-dashed border-zinc-700/50"
              >
                <Plus className="w-3.5 h-3.5" /> {t('add')}
              </button>
            </div>
          )
        })}

        {/* Add column */}
        <button
          onClick={() => { setEditingTask({ _type: 'add_column' }); setShowModal(true) }}
          className="flex-shrink-0 w-72 h-12 flex items-center justify-center gap-2 bg-zinc-900/30 hover:bg-zinc-900/60 text-zinc-600 hover:text-zinc-400 rounded-2xl text-sm font-bold transition-all border border-dashed border-zinc-800"
        >
          <Plus className="w-4 h-4" /> {t('new_column')}
        </button>
      </div>

      {/* Modal */}
      {showModal && (
        <KanbanModal
          task={editingTask}
          columns={columns}
          members={members}
          projectId={projectId}
          onClose={() => { setShowModal(false); setEditingTask(null) }}
          onSave={() => { setShowModal(false); setEditingTask(null); fetchBoard() }}
        />
      )}
    </div>
  )
}

function KanbanModal({ task, columns, members, projectId, onClose, onSave }: any) {
  const t = useTranslations('Projects.kanban')
  const locale = useLocale()
  const isNew = !task?.id
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: task?.title || '',
    description: task?.description || '',
    columnId: task?.columnId || columns[0]?.id || '',
    priority: task?.priority || 'medium',
    assigneeId: task?.assigneeId || '',
    dueDate: task?.dueDate ? String(task.dueDate).slice(0, 10) : '',
    _type: task?._type || (isNew ? 'add_task' : 'task'),
  })

  const handleSave = async () => {
    if (!form.title.trim()) { setError(t('title_required')); return }
    setSaving(true)
    setError(null)
    try {
      let res: Response
      if (form._type === 'add_column') {
        res = await fetch(`/api/projects/${projectId}/columns`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: form.title, projectId, color: '#6366f1', position: columns.length })
        })
      } else if (isNew) {
        res = await fetch(`/api/projects/${projectId}/tasks`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, projectId })
        })
      } else {
        // L'API PUT identifie la tâche par taskId
        res = await fetch(`/api/projects/${projectId}/tasks`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, taskId: task.id, projectId })
        })
      }
      if (!res.ok) { setError(await readApiError(res, locale)); return }
      onSave()
    } catch {
      setError(t('save_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-zinc-900 rounded-3xl w-full max-w-lg border border-zinc-700 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <span className="text-xs font-black text-zinc-500 uppercase tracking-widest">
            {form._type === 'add_column' ? t('new_column') : isNew ? t('new_task') : t('edit_task')}
          </span>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-xl"><X className="w-5 h-5 text-zinc-400" /></button>
        </div>

        <div className="p-6 space-y-4">
          {error && <div role="alert" className="px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>}
          <input
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
            placeholder={form._type === 'add_column' ? t('column_name') : t('task_title')}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white font-bold placeholder-zinc-600 focus:outline-none focus:border-teal-500"
          />
          {form._type !== 'add_column' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 block">{t('column')}</label>
                  <select value={form.columnId} onChange={e => setForm({ ...form, columnId: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500">
                    {columns.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 block">{t('priority')}</label>
                  <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500">
                    <option value="low">{t('priority_low')}</option><option value="medium">{t('priority_medium')}</option>
                    <option value="high">{t('priority_high')}</option><option value="critical">{t('priority_critical')}</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 block">{t('assignee')}</label>
                  <select value={form.assigneeId} onChange={e => setForm({ ...form, assigneeId: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500">
                    <option value="">{t('unassigned')}</option>
                    {members.map((m: any) => <option key={m.id} value={m.id}>{m.firstName || m.email}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 block">{t('due')}</label>
                  <input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-teal-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-1.5 block">{t('description')}</label>
                <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={3}
                  placeholder={t('details')} className="w-full bg-zinc-800/50 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-teal-500 resize-none" />
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-zinc-800">
          <button onClick={onClose} className="px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-bold text-sm">{t('cancel')}</button>
          <button onClick={handleSave}
            disabled={!form.title.trim() || saving}
            className="px-5 py-2.5 bg-teal-600 hover:bg-teal-500 disabled:bg-zinc-700 text-white rounded-xl font-black text-sm">
            {isNew || form._type === 'add_column' ? t('create') : t('save')}
          </button>
        </div>
      </div>
    </div>
  )
}
