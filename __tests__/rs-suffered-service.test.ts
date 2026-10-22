const mockPrisma: any = {
  invoice: { findFirst: jest.fn() },
  withholdingTax: { findFirst: jest.fn(), create: jest.fn((a: any) => Promise.resolve({ id: 'rs1', ...a.data })), findMany: jest.fn() },
  tenant: { findUnique: jest.fn() },
  purchaseOrder: { findMany: jest.fn() },
}
jest.mock('@/lib/db', () => ({ get prisma() { return mockPrisma } }))
import { generateSufferedFromInvoice } from '@/services/withholding-tax'
import { exportTEJ } from '@/lib/tej-generator'

beforeEach(() => jest.clearAllMocks())

test('facture de vente → RS SUBIE, taux selon le régime du tenant, sans référence TEJ', async () => {
  mockPrisma.invoice.findFirst.mockResolvedValue({
    id: 'i1', type: 'INVOICE_HONORARY', number: 'NH-2026-00001', totalTTC: 1500, date: new Date('2026-10-01'), dueDate: null,
    client: { name: 'Client SA', matriculeFiscal: '7654321BAM000' }, tenant: { name: 'Cabinet', matriculeFiscal: '1234567AAM000' },
  })
  mockPrisma.withholdingTax.findFirst.mockResolvedValue(null)
  const rs: any = await generateSufferedFromInvoice('i1', 't1')
  expect(rs.direction).toBe('SUFFERED')
  expect(rs.rate).toBe(0.03)
  expect(rs.taxAmount).toBe(45)
  expect(rs.tejId).toBeUndefined()
})

test('devis refusé, doublon 409', async () => {
  mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'q', type: 'QUOTE' })
  await expect(generateSufferedFromInvoice('q', 't1')).rejects.toMatchObject({ statusCode: 400 })
  mockPrisma.invoice.findFirst.mockResolvedValue({ id: 'i1', type: 'INVOICE', tenant: {}, client: {} })
  mockPrisma.withholdingTax.findFirst.mockResolvedValue({ id: 'x', tejStatus: 'DRAFT' })
  await expect(generateSufferedFromInvoice('i1', 't1')).rejects.toMatchObject({ statusCode: 409 })
})

test('export TEJ : RS subies exclues de la requête', async () => {
  mockPrisma.tenant.findUnique.mockResolvedValue({ matriculeFiscal: '1234567AAM000', settings: {} })
  mockPrisma.withholdingTax.findMany.mockResolvedValue([])
  await expect(exportTEJ({ tenantId: 't1', periodYear: 2026, periodMonth: 10 })).rejects.toThrow(/Aucune retenue/)
  expect(mockPrisma.withholdingTax.findMany.mock.calls[0][0].where.direction).toEqual({ not: 'SUFFERED' })
})
