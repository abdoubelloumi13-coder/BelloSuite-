/** Comptabilisation des documents de vente : types autorisés et idempotence (accountingEntryId). */
const tx: any = {
  invoice: { findFirst: jest.fn(), updateMany: jest.fn() },
  journalEntry: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  accountingJournal: { upsert: jest.fn().mockResolvedValue({ id: 'j1' }) },
  accountingPeriod: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', isClosed: false, name: '2026' }), upsert: jest.fn() },
  accountingAccount: { upsert: jest.fn(({ create }: any) => Promise.resolve({ id: 'acc-' + create.accountNumber })) },
}
jest.mock('@/lib/db', () => ({ prisma: { $transaction: (fn: any) => fn(tx) } }))

import { generateInvoiceEntry } from '@/services/accounting'

const inv = (o: any = {}) => ({
  id: 'i1', tenantId: 't1', type: 'INVOICE', status: 'PENDING', number: 'FAC-2026-00001', date: new Date('2026-10-01'),
  subtotalHT: 100, totalFodec: 0, totalVAT: 19, timbreFiscal: 1, totalTTC: 120, accountingEntryId: null, client: { name: 'C' }, ...o,
})

beforeEach(() => jest.clearAllMocks())

test('devis / BL refusés', async () => {
  tx.invoice.findFirst.mockResolvedValue(inv({ type: 'QUOTE' }))
  await expect(generateInvoiceEntry('i1', 't1', { posted: true })).rejects.toMatchObject({ statusCode: 400 })
  tx.invoice.findFirst.mockResolvedValue(inv({ type: 'DELIVERY_NOTE' }))
  await expect(generateInvoiceEntry('i1', 't1', { posted: false })).rejects.toMatchObject({ statusCode: 400 })
  expect(tx.journalEntry.create).not.toHaveBeenCalled()
})

test('première écriture : créée et liée conditionnellement', async () => {
  tx.invoice.findFirst.mockResolvedValue(inv())
  tx.journalEntry.findFirst.mockResolvedValue(null)
  tx.journalEntry.create.mockResolvedValue({ id: 'e1' })
  tx.invoice.updateMany.mockResolvedValue({ count: 1 })
  await generateInvoiceEntry('i1', 't1', { posted: true })
  const data = tx.journalEntry.create.mock.calls[0][0].data
  expect(data.entryNumber).toBe('VT-FAC-2026-00001')
  expect(data.isPosted).toBe(true)
  expect(tx.invoice.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'i1', accountingEntryId: null })
})

test('course perdue : 409', async () => {
  tx.invoice.findFirst.mockResolvedValue(inv())
  tx.journalEntry.findFirst.mockResolvedValue(null)
  tx.journalEntry.create.mockResolvedValue({ id: 'e1' })
  tx.invoice.updateMany.mockResolvedValue({ count: 0 })
  await expect(generateInvoiceEntry('i1', 't1', { posted: true })).rejects.toMatchObject({ statusCode: 409 })
})

test('écriture existante : renvoyée (brouillon), validée (post) puis 409', async () => {
  tx.invoice.findFirst.mockResolvedValue(inv({ accountingEntryId: 'e1' }))
  tx.journalEntry.findFirst.mockResolvedValue({ id: 'e1', isPosted: false })
  const r = await generateInvoiceEntry('i1', 't1', { posted: false })
  expect(r).toMatchObject({ id: 'e1', alreadyExists: true })
  tx.journalEntry.update.mockResolvedValue({ id: 'e1', isPosted: true })
  await generateInvoiceEntry('i1', 't1', { posted: true })
  expect(tx.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isPosted: true } }))
  tx.journalEntry.findFirst.mockResolvedValue({ id: 'e1', isPosted: true })
  await expect(generateInvoiceEntry('i1', 't1', { posted: true })).rejects.toMatchObject({ statusCode: 409 })
  expect(tx.journalEntry.create).not.toHaveBeenCalled()
})
