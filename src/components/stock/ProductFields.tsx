'use client'

/** Champs produit liés aux référentiels stock (catégories, unités, dépôts). */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown, ChevronUp, Check } from 'lucide-react'
import SmartInput from '@/components/ui/SmartInput'

type Unit = { id?: string; code: string; name: string; decimals?: number; productCount?: number }
type Warehouse = { id: string; code: string; name: string; isDefault?: boolean }

export function useStockReferentials() {
  const [categories, setCategories] = useState<string[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  useEffect(() => {
    Promise.all([
      fetch('/api/stock/categories').then(r => (r.ok ? r.json() : [])),
      fetch('/api/stock/units').then(r => (r.ok ? r.json() : [])),
      fetch('/api/stock/warehouses').then(r => (r.ok ? r.json() : [])),
    ]).then(([c, u, w]) => {
      setCategories((c as Array<{ name: string }>).map(x => x.name))
      setUnits(u as Unit[])
      setWarehouses(w as Warehouse[])
    }).catch(() => {})
  }, [])
  return { categories, units, warehouses }
}

export function CategoryInput({ value, onChange, className, categories }: { value: string; onChange: (v: string) => void; className: string; categories: string[] }) {
  return (
    <SmartInput
      value={value}
      onChange={onChange}
      suggestions={categories}
      className={className}
    />
  )
}

/** Trie les unités par popularité (utilisation) puis par nom. */
function sortByPopularity(units: Unit[]): Unit[] {
  return [...units].sort((a, b) => {
    const ac = a.productCount ?? 0
    const bc = b.productCount ?? 0
    if (bc !== ac) return bc - ac
    return a.name.localeCompare(b.name)
  })
}

/** Recherche par code ou nom (insensible à la casse, accents). */
function matches(unit: Unit, q: string): boolean {
  if (!q) return true
  const s = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return (
    unit.code.toLowerCase().includes(s) ||
    unit.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(s)
  )
}

/** Liste déroulante intelligente avec autocomplétion et suggestions par popularité. */
export function UnitSelect({ value, onChange, className, units, placeholder }: { value: string; onChange: (v: string) => void; className: string; units: Unit[]; placeholder?: string }) {
  const t = useTranslations('StockMod')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const popular = sortByPopularity(units)
  const filtered = popular.filter(u => matches(u, query))
  const selected = units.find(u => u.code === value)

  const toggle = () => {
    setOpen(o => !o)
    if (!open) setQuery('')
  }

  const pick = (code: string) => {
    onChange(code)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className={`relative ${className || ''}`}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border border-stone-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 ${open ? 'ring-2 ring-teal-500/30 border-teal-500' : ''}`}
      >
        <span className={selected ? 'text-stone-900 font-medium' : 'text-stone-400'}>
          {selected ? `${selected.name} (${selected.code})` : (placeholder || t('unit'))}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-stone-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-stone-400 shrink-0" />}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[220px] bg-white border border-stone-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-stone-100">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Rechercher (code ou nom)…"
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg border border-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500"
            />
          </div>
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-sm text-stone-400 text-center">Aucune unité trouvée</p>
            ) : (
              filtered.map(u => {
                const isSel = u.code === value
                return (
                  <button
                    key={u.id || u.code}
                    type="button"
                    onClick={() => pick(u.code)}
                    className={`w-full flex items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-teal-50 transition-colors ${isSel ? 'bg-teal-50 text-teal-700 font-medium' : 'text-stone-700'}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-xs text-stone-400">{u.code}</span>
                      <span>{u.name}</span>
                      {(u.decimals ?? 0) > 0 && <span className="text-[10px] text-stone-300">({u.decimals} déc.)</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      {(u.productCount ?? 0) > 0 && (
                        <span className="text-[10px] text-stone-400">{u.productCount} prod.</span>
                      )}
                      {isSel && <Check className="w-4 h-4 text-teal-600 shrink-0" />}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}