/**
 * Suppression définitive d'une entreprise et de TOUTES ses données (super admin).
 * Le plan est déduit du schéma Prisma (DMMF) : aucune liste de tables à maintenir.
 *  1. tables « tenant » : colonne tenantId, ou rattachées par une FK vers une table tenant ;
 *  2. les FK facultatives entre tables tenant sont d'abord mises à NULL (cycles, auto-références) ;
 *  3. suppression enfants → parents (tri topologique sur les FK obligatoires), puis Tenant.
 * Le journal d'audit (AuditLog) est conservé.
 */
import { Prisma, type PrismaClient } from '@prisma/client'

interface DField { name: string; kind: string; type: string; dbName?: string | null; isRequired: boolean; relationFromFields?: readonly string[]; relationToFields?: readonly string[] }
interface DModel { name: string; dbName?: string | null; fields: readonly DField[] }

export const PURGE_EXCLUDED = new Set(['AuditLog', 'Tenant', 'Module'])

export interface PurgeStep { model: string; table: string; where: string }
export interface PurgePlan { nullify: { table: string; column: string; where: string }[]; deletes: PurgeStep[] }

const q = (s: string) => `"${s.replace(/"/g, '""')}"`

export function buildPurgePlan(models: readonly DModel[]): PurgePlan {
  const byName = new Map(models.map(m => [m.name, m]))
  const table = (m: DModel) => q(m.dbName || m.name)
  const col = (m: DModel, field: string) => { const f = m.fields.find(x => x.name === field); return q(f?.dbName || field) }
  const fks = (m: DModel) => m.fields.filter(f => f.kind === 'object' && f.relationFromFields && f.relationFromFields.length === 1)

  // Condition SQL (sur $1 = tenantId) de chaque modèle rattaché à l'entreprise
  const cond = new Map<string, string>()
  for (const m of models) {
    if (PURGE_EXCLUDED.has(m.name)) continue
    if (m.fields.some(f => f.name === 'tenantId' && f.kind === 'scalar')) cond.set(m.name, `${col(m, 'tenantId')} = $1`)
  }
  for (let changed = true; changed;) {
    changed = false
    for (const m of models) {
      if (PURGE_EXCLUDED.has(m.name) || cond.has(m.name)) continue
      for (const f of fks(m)) {
        const parent = byName.get(f.type)
        if (!parent || !cond.has(parent.name)) continue
        const pk = col(parent, f.relationToFields?.[0] || 'id')
        cond.set(m.name, `${col(m, f.relationFromFields![0])} IN (SELECT ${pk} FROM ${table(parent)} WHERE ${cond.get(parent.name)})`)
        changed = true
        break
      }
    }
  }

  // FK facultatives entre tables rattachées → NULL ; FK obligatoires → ordre de suppression
  const nullify: PurgePlan['nullify'] = []
  const deps = new Map<string, Set<string>>() // parent -> enfants qui doivent partir avant
  for (const name of cond.keys()) deps.set(name, new Set())
  for (const name of cond.keys()) {
    const m = byName.get(name)!
    for (const f of fks(m)) {
      if (!cond.has(f.type)) continue
      const fkField = m.fields.find(x => x.name === f.relationFromFields![0])
      if (fkField && !fkField.isRequired) nullify.push({ table: table(m), column: col(m, fkField.name), where: cond.get(name)! })
      else if (f.type !== name) deps.get(f.type)!.add(name)
    }
  }
  const order: string[] = []
  const state = new Map<string, 1 | 2>()
  const visit = (n: string) => {
    if (state.get(n) === 2) return
    if (state.get(n) === 1) return // cycle de FK obligatoires : rare, la suppression échouera proprement
    state.set(n, 1)
    for (const child of deps.get(n) ?? []) visit(child)
    state.set(n, 2)
    order.push(n)
  }
  ;[...cond.keys()].sort().forEach(visit)
  return { nullify, deletes: order.map(n => ({ model: n, table: table(byName.get(n)!), where: cond.get(n)! })) }
}

/** Exécute la purge dans une transaction. Renvoie le nombre de lignes supprimées par table. */
export async function purgeTenant(prisma: PrismaClient, tenantId: string) {
  const plan = buildPurgePlan(Prisma.dmmf.datamodel.models as unknown as DModel[])
  const counts: Record<string, number> = {}
  await prisma.$transaction(async tx => {
    for (const n of plan.nullify) await tx.$executeRawUnsafe(`UPDATE ${n.table} SET ${n.column} = NULL WHERE ${n.where}`, tenantId)
    for (const d of plan.deletes) {
      const c = await tx.$executeRawUnsafe(`DELETE FROM ${d.table} WHERE ${d.where}`, tenantId)
      if (c) counts[d.model] = c
    }
    await tx.$executeRawUnsafe(`DELETE FROM "Tenant" WHERE "id" = $1`, tenantId)
  }, { timeout: 120_000, maxWait: 10_000 })
  return counts
}
