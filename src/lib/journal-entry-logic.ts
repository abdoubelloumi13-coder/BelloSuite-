/** Règles pures d'une écriture manuelle (partie double). */
export interface EntryLineInput { accountId: string; debit: number; credit: number; description?: string | null }

export const round3 = (n: number) => Math.round((Number(n) || 0) * 1000) / 1000

/** Renvoie un message d'erreur (français) ou null si l'écriture est valide. */
export function validateEntryLines(lines: EntryLineInput[]): string | null {
  const used = lines.filter(l => round3(l.debit) !== 0 || round3(l.credit) !== 0)
  if (used.length < 2) return 'Une écriture comporte au moins deux lignes non nulles'
  for (const l of used) {
    if (!l.accountId) return 'Chaque ligne doit avoir un compte'
    if (l.debit < 0 || l.credit < 0) return 'Les montants doivent être positifs'
    if (round3(l.debit) > 0 && round3(l.credit) > 0) return 'Une ligne ne peut pas être à la fois au débit et au crédit'
  }
  const { debit, credit } = entryTotals(used)
  if (Math.abs(debit - credit) >= 0.001) return `Écriture déséquilibrée : débit ${debit.toFixed(3)} ≠ crédit ${credit.toFixed(3)}`
  return null
}

export function entryTotals(lines: Pick<EntryLineInput, 'debit' | 'credit'>[]) {
  return {
    debit: round3(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)),
    credit: round3(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)),
  }
}

/** Prochain numéro « CODE-AAAA-0001 » à partir des numéros existants du même préfixe. */
export function nextEntryNumber(journalCode: string, year: number, existing: string[]): string {
  const prefix = `${journalCode}-${year}-`
  const max = existing
    .filter(n => n.startsWith(prefix))
    .map(n => parseInt(n.slice(prefix.length), 10))
    .filter(Number.isFinite)
    .reduce((m, n) => Math.max(m, n), 0)
  return `${prefix}${String(max + 1).padStart(4, '0')}`
}
