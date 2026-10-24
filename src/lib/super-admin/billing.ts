/**
 * Facturation SaaS par module et par entreprise (pur, testable sans base).
 * Prix d'un module = (prix négocié ?? prix catalogue) + utilisateurs au-delà des inclus × prix/utilisateur,
 * puis remise %. Utilisateurs facturés = sièges attribués au module, ou tous les utilisateurs actifs si 0.
 */
export interface BillingModule { id: string; name: string; displayName: string; monthlyPrice: unknown; pricePerUser?: unknown; includedUsers?: number | null }
export interface BillingTenantModule { moduleId: string; isEnabled: boolean; seats?: number | null; priceOverride?: unknown; discountPercent?: unknown }

/**
 * Utilisateurs inclus et prix par utilisateur en sus, par module (HT/mois). Pas de colonne en base :
 * déploiement sans migration. Le prix de base reste Module.monthlyPrice (modifiable par le super admin).
 */
export const MODULE_USER_PRICING: Record<string, { includedUsers: number; pricePerUser: number }> = {
  commercial: { includedUsers: 3, pricePerUser: 2 },
  stock: { includedUsers: 3, pricePerUser: 2 },
  pos: { includedUsers: 1, pricePerUser: 5 },
  accounting: { includedUsers: 2, pricePerUser: 3 },
  hr: { includedUsers: 2, pricePerUser: 3 },
  crm: { includedUsers: 5, pricePerUser: 2 },
  gmao: { includedUsers: 3, pricePerUser: 3 },
  gpao: { includedUsers: 3, pricePerUser: 3 },
}
export const DEFAULT_USER_PRICING = { includedUsers: 3, pricePerUser: 2 }

/** Ajoute la grille utilisateurs à un module du catalogue. */
export function withUserPricing<T extends { name: string }>(m: T): T & { includedUsers: number; pricePerUser: number } {
  return { ...m, ...(MODULE_USER_PRICING[m.name] ?? DEFAULT_USER_PRICING) }
}

/** Paramètres de facturation d'un module d'entreprise, stockés dans TenantModule.settings.billing. */
export function billingSettings(settings: unknown): { seats: number; priceOverride: number | null; discountPercent: number } {
  const b = (settings && typeof settings === 'object' ? (settings as Record<string, unknown>).billing : null) as Record<string, unknown> | null
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? x : 0 }
  return {
    seats: Math.round(n(b?.seats)),
    priceOverride: b && b.priceOverride !== null && b.priceOverride !== undefined && b.priceOverride !== '' ? n(b.priceOverride) : null,
    discountPercent: Math.min(100, n(b?.discountPercent)),
  }
}

const num = (v: unknown) => { const x = Number(v ?? 0); return Number.isFinite(x) ? x : 0 }
const r3 = (x: number) => Math.round(x * 1000) / 1000

export interface ModuleCharge {
  moduleId: string; name: string; displayName: string
  users: number; includedUsers: number; extraUsers: number
  base: number; usersAmount: number; discount: number; total: number; negotiated: boolean
}

export function moduleCharge(mod: BillingModule, tm: BillingTenantModule, activeUsers: number): ModuleCharge {
  const users = Math.max(0, tm.seats && tm.seats > 0 ? tm.seats : activeUsers)
  const includedUsers = Math.max(0, mod.includedUsers ?? 0)
  const extraUsers = Math.max(0, users - includedUsers)
  const negotiated = tm.priceOverride !== null && tm.priceOverride !== undefined && tm.priceOverride !== ''
  const base = Math.max(0, negotiated ? num(tm.priceOverride) : num(mod.monthlyPrice))
  const usersAmount = extraUsers * Math.max(0, num(mod.pricePerUser))
  const pct = Math.min(100, Math.max(0, num(tm.discountPercent)))
  const discount = (base + usersAmount) * pct / 100
  return {
    moduleId: mod.id, name: mod.name, displayName: mod.displayName, users, includedUsers, extraUsers,
    base: r3(base), usersAmount: r3(usersAmount), discount: r3(discount), total: r3(base + usersAmount - discount), negotiated,
  }
}

/** Facture mensuelle HT d'une entreprise : une ligne par module activé. TVA 19 % sur les services numériques. */
export function tenantInvoice(modules: BillingModule[], tenantModules: BillingTenantModule[], activeUsers: number, vatRate = 0.19) {
  const byId = new Map(modules.map(m => [m.id, m]))
  const lines = tenantModules
    .filter(tm => tm.isEnabled && byId.has(tm.moduleId))
    .map(tm => moduleCharge(byId.get(tm.moduleId)!, tm, activeUsers))
  const totalHT = r3(lines.reduce((s, l) => s + l.total, 0))
  const tva = r3(totalHT * vatRate)
  return { lines, totalHT, tva, totalTTC: r3(totalHT + tva) }
}

/** Score d'activité 0-100 sur 30 jours (documents créés) et statut lisible. */
export function activityScore(docs30d: number, lastActivity: Date | null, now = new Date()) {
  const idleDays = lastActivity ? Math.floor((now.getTime() - lastActivity.getTime()) / 86_400_000) : null
  const score = Math.min(100, Math.round(Math.log10(1 + Math.max(0, docs30d)) * 40))
  const status = idleDays === null ? 'never' : idleDays <= 7 ? 'active' : idleDays <= 30 ? 'slowing' : 'dormant'
  return { score, idleDays, status: status as 'never' | 'active' | 'slowing' | 'dormant' }
}
