import { buildPurgePlan } from '@/lib/super-admin/tenant-purge'
import { Prisma } from '@prisma/client'

const f = (name: string, extra: Record<string, unknown> = {}) => ({ name, kind: 'scalar', type: 'String', isRequired: true, ...extra })
const rel = (name: string, type: string, from: string) => ({ name, kind: 'object', type, isRequired: true, relationFromFields: [from], relationToFields: ['id'] })

describe('purge entreprise', () => {
  const models = [
    { name: 'Tenant', fields: [f('id')] },
    { name: 'Invoice', fields: [f('id'), f('tenantId'), f('clientId'), rel('client', 'Client', 'clientId')] },
    { name: 'InvoiceLine', fields: [f('id'), f('invoiceId'), rel('invoice', 'Invoice', 'invoiceId')] },
    { name: 'Client', fields: [f('id'), f('tenantId')] },
    { name: 'Account', fields: [f('id'), f('tenantId'), f('parentId', { isRequired: false }), rel('parent', 'Account', 'parentId')] },
    { name: 'AuditLog', fields: [f('id'), f('tenantId')] },
  ]
  const plan = buildPurgePlan(models)
  const order = plan.deletes.map(d => d.model)

  it('supprime les enfants avant les parents et garde le journal', () => {
    expect(order.indexOf('InvoiceLine')).toBeLessThan(order.indexOf('Invoice'))
    expect(order.indexOf('Invoice')).toBeLessThan(order.indexOf('Client'))
    expect(order).not.toContain('AuditLog')
    expect(plan.deletes.find(d => d.model === 'InvoiceLine')!.where).toContain('SELECT "id" FROM "Invoice" WHERE "tenantId" = $1')
  })
  it('met à NULL les auto-références facultatives', () => {
    expect(plan.nullify).toEqual([{ table: '"Account"', column: '"parentId"', where: '"tenantId" = $1' }])
  })
  it('couvre le vrai schéma sans cycle bloquant', () => {
    const real = buildPurgePlan(Prisma.dmmf.datamodel.models as never)
    const names = real.deletes.map(d => d.model)
    for (const m of ['User', 'Invoice', 'Product', 'Employee', 'PaySlip', 'JournalEntry', 'POSOrder']) expect(names).toContain(m)
    expect(names.indexOf('PaySlip')).toBeLessThan(names.indexOf('Employee'))
    expect(new Set(names).size).toBe(names.length)
  })
})
