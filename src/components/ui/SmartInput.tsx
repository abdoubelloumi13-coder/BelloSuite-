'use client'

/**
 * SmartInput — champ de saisie intelligente transversal ERP.
 *
 * - Suggestion en direct pendant la frappe (insensible à la casse ET aux accents)
 * - Les valeurs les plus fréquemment utilisées remontent en priorité (usageCount)
 * - Navigation clavier : ↑ ↓ pour naviguer, Entrée pour confirmer, Échap pour fermer
 * - Compatible avec les formulaires natifs : <input name> + onChange classique
 *
 * Usage :
 *   <SmartInput
 *     name="category"
 *     value={formData.category}
 *     onChange={v => setFormData(p => ({ ...p, category: v }))}
 *     suggestions={assetCategories}
 *     placeholder="ex. Mécanique, Électrique…"
 *   />
 */
import { useEffect, useMemo, useRef, useState } from 'react'

export type Suggestion =
  | string
  | { value: string; label?: string; count?: number; hint?: string }

interface SmartInputProps {
  suggestions: Suggestion[]
  value: string
  onChange: (v: string) => void
  name?: string
  placeholder?: string
  className?: string
  required?: boolean
  disabled?: boolean
  /** Classe du champ (défaut : harmonisé BelloSuite). */
  inputClassName?: string
  /** On peut appeler un callback quand l'utilisateur choisit une suggestion. */
  onSelect?: (v: string) => void
}

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function toObj(s: Suggestion): { value: string; label?: string; count?: number; hint?: string } {
  return typeof s === 'string' ? { value: s } : s
}

export default function SmartInput({
  suggestions,
  value,
  onChange,
  name,
  placeholder,
  className,
  required,
  disabled,
  inputClassName,
  onSelect,
}: SmartInputProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Suggestions triées : les plus utilisées d'abord, puis alphabet.
  // On exclut la valeur courante (déjà choisie).
  const filtered = useMemo(() => {
    const all = suggestions.map(toObj)
    const q = norm(value)
    const scored = all
      .filter(s => !value || norm(s.value) !== q) // exclut le choix actuel
      .filter(s => {
        if (!q) return true
        return norm(s.value).includes(q)
      })
      .sort((a, b) => {
        // 1) préfixe exact d'abord, 2) usage, 3) alphabétique
        const aPre = norm(a.value).startsWith(q) ? 0 : 1
        const bPre = norm(b.value).startsWith(q) ? 0 : 1
        if (aPre !== bPre) return aPre - bPre
        const ac = a.count ?? 0
        const bc = b.count ?? 0
        if (bc !== ac) return bc - ac
        return a.value.localeCompare(b.value)
      })
    return scored.slice(0, 12)
  }, [suggestions, value])

  // Fermer au clic extérieur
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Réinitialiser le highlight quand la liste change
  useEffect(() => { setHighlight(0) }, [filtered.length, value])

  const pick = (v: string) => {
    onChange(v)
    setOpen(false)
    inputRef.current?.blur()
    onSelect?.(v)
  }

  const showList = open && !disabled && filtered.length > 0

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!showList) {
      if (e.key === 'ArrowDown' && filtered.length) setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % filtered.length) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + filtered.length) % filtered.length) }
    else if (e.key === 'Enter') {
      if (highlight >= 0 && highlight < filtered.length) {
        e.preventDefault()
        pick(filtered[highlight].value)
      }
    } else if (e.key === 'Escape') { setOpen(false) }
  }

  return (
    <div ref={rootRef} className={`relative ${className || ''}`}>
      <input
        ref={inputRef}
        name={name}
        required={required}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={
          inputClassName ||
          'w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-all'
        }
      />
      {showList && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] bg-white border border-stone-200 rounded-2xl shadow-xl overflow-hidden">
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((s, i) => (
              <button
                key={s.value}
                type="button"
                onMouseDown={e => { e.preventDefault(); pick(s.value) }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-start px-4 py-2 text-sm transition-colors ${
                  i === highlight ? 'bg-teal-50 text-teal-800' : 'text-stone-700 hover:bg-stone-50'
                }`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span>
                    {s.label || s.value}
                    {s.hint && <span className="ms-2 text-[11px] text-stone-400">{s.hint}</span>}
                  </span>
                  {(s.count ?? 0) > 1 && (
                    <span className="text-[10px] font-bold text-stone-400 shrink-0">
                      ×{s.count}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
