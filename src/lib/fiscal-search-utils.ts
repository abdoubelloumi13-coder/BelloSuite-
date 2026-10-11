/**
 * Utilitaires purs (client + serveur) de l'assistant fiscal / recherche dans les textes :
 * extrait centré sur les termes de la requête, découpage d'une réponse en texte + références [n].
 */

const STOP = new Set([
  'le', 'la', 'les', 'des', 'du', 'de', 'un', 'une', 'et', 'ou', 'en', 'au', 'aux', 'est', 'sur', 'pour', 'par', 'quel', 'quelle', 'quels', 'quelles',
  'the', 'of', 'and', 'or', 'is', 'are', 'what', 'which', 'for', 'on', 'in', 'to', 'a', 'an',
  'في', 'من', 'على', 'إلى', 'عن', 'ما', 'هو', 'هي', 'هل',
])

/** Termes significatifs d'une requête (≥ 3 lettres ou chiffres), sans diacritiques arabes. */
export function queryTerms(q: string): string[] {
  const words = q
    .normalize('NFC')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOP.has(w))
  return Array.from(new Set(words)).slice(0, 12)
}

/** Extrait de ~`size` caractères centré sur la première occurrence d'un terme de la requête. */
export function snippetFor(content: string, q: string, size = 320): string {
  const text = content.replace(/\s+/g, ' ').trim()
  if (text.length <= size) return text
  const lower = text.toLowerCase()
  let pos = -1
  for (const t of queryTerms(q)) {
    const i = lower.indexOf(t)
    if (i >= 0 && (pos < 0 || i < pos)) pos = i
  }
  if (pos < 0) return `${text.slice(0, size).trimEnd()}…`
  const start = Math.max(0, pos - Math.floor(size / 3))
  const end = Math.min(text.length, start + size)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

export type AnswerSegment = { type: 'text'; text: string } | { type: 'ref'; n: number }

/** Découpe une réponse en segments texte / références [n] (gère « [1, 3] » et « [2][4] ») pour afficher des puces cliquables. */
export function splitAnswer(answer: string): AnswerSegment[] {
  const out: AnswerSegment[] = []
  let last = 0
  for (const m of answer.matchAll(/\[(\d+(?:\s*[,;،]\s*\d+)*)\]/g)) {
    const idx = m.index ?? 0
    if (idx > last) out.push({ type: 'text', text: answer.slice(last, idx) })
    for (const n of m[1].split(/[,;،]/)) {
      const v = Number(n.trim())
      if (Number.isInteger(v) && v > 0) out.push({ type: 'ref', n: v })
    }
    last = idx + m[0].length
  }
  if (last < answer.length) out.push({ type: 'text', text: answer.slice(last) })
  return out
}

/** Libellé court d'une citation pour une puce : « TVA art. 7 · 2026 ». */
export function shortCitation(c: { code: string; article: string | null; version: string }, lang: string): string {
  const art = c.article ? (lang === 'ar' ? ` الفصل ${c.article}` : ` art. ${c.article}`) : ''
  return `${c.code}${art} · ${c.version}`
}

/** Questions suggérées (clés i18n FiscalAssistant.suggest_*). */
export const SUGGESTED_QUESTION_KEYS = ['suggest_vat_rates', 'suggest_stamp', 'suggest_fodec', 'suggest_withholding', 'suggest_export'] as const
