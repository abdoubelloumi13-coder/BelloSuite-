/**
 * Relances : déduplication (intervalle 7 j, canal préféré unique), statut « simulated », délais.
 */
import { shouldRemind, lastCountedReminder, orderedChannels, channelAvailable, withTimeout, DEFAULT_REMINDER_INTERVAL_DAYS } from '@/lib/reminder-logic'

const mockDb = {
  invoice: { findMany: jest.fn(), update: jest.fn((a: unknown) => a) },
  user: { findFirst: jest.fn() },
  paymentReminder: { create: jest.fn((a: unknown) => Promise.resolve(a)) },
  paymentFollowUp: { update: jest.fn((a: unknown) => a) },
  $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
}
jest.mock('@/lib/db', () => ({ prisma: mockDb }))

import { sendAutoReminders } from '@/lib/reminder-service'

const NOW = new Date('2026-10-21T08:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000)

describe('shouldRemind', () => {
  it('intervalle par défaut = 7 jours', () => {
    expect(DEFAULT_REMINDER_INTERVAL_DAYS).toBe(7)
    expect(shouldRemind({ now: NOW, lastReminderAt: daysAgo(1) }).ok).toBe(false)
    expect(shouldRemind({ now: NOW, lastReminderAt: daysAgo(6.9) }).ok).toBe(false)
    expect(shouldRemind({ now: NOW, lastReminderAt: daysAgo(7) }).ok).toBe(true)
    expect(shouldRemind({ now: NOW, lastReminderAt: null }).ok).toBe(true)
  })
  it('intervalle personnalisé et date planifiée', () => {
    expect(shouldRemind({ now: NOW, intervalDays: 3, lastReminderAt: daysAgo(4) }).ok).toBe(true)
    expect(shouldRemind({ now: NOW, nextReminderDate: new Date(NOW.getTime() + 3600_000) }).ok).toBe(false)
  })
})

describe('lastCountedReminder', () => {
  it('ignore les échecs, compte sent/simulated, et lastReminderSentAt', () => {
    expect(lastCountedReminder([{ sentAt: daysAgo(1), response: 'failed' }, { sentAt: daysAgo(10), response: 'sent' }])?.getTime()).toBe(daysAgo(10).getTime())
    expect(lastCountedReminder([{ sentAt: daysAgo(2), response: 'simulated' }])?.getTime()).toBe(daysAgo(2).getTime())
    expect(lastCountedReminder([], daysAgo(3))?.getTime()).toBe(daysAgo(3).getTime())
    expect(lastCountedReminder([{ sentAt: daysAgo(1), response: 'failed' }])).toBeNull()
  })
})

describe('canaux', () => {
  it('e-mail du client uniquement, téléphone ≥ 8 chiffres', () => {
    expect(channelAvailable('EMAIL', { email: '' })).toBe(false)
    expect(channelAvailable('EMAIL', { email: 'a@b.tn' })).toBe(true)
    expect(channelAvailable('WHATSAPP', { phone: '22 333 444' })).toBe(true)
    expect(channelAvailable('SMS', { phone: '123' })).toBe(false)
  })
  it('ordre de préférence, sans doublon, limité aux canaux joignables', () => {
    expect(orderedChannels(['EMAIL', 'WHATSAPP', 'EMAIL'], { email: 'a@b.tn', phone: '22333444' })).toEqual(['EMAIL', 'WHATSAPP'])
    expect(orderedChannels(['EMAIL', 'WHATSAPP'], { phone: '22333444' })).toEqual(['WHATSAPP'])
    expect(orderedChannels(['EMAIL'], {})).toEqual([])
  })
})

describe('withTimeout', () => {
  it('rejette après le délai', async () => {
    await expect(withTimeout(new Promise(() => {}), 20, 'SMTP')).rejects.toThrow(/délai dépassé/)
    await expect(withTimeout(Promise.resolve(3), 20)).resolves.toBe(3)
  })
})

describe('sendAutoReminders (dédup + simulated)', () => {
  const OLD_ENV = process.env
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...OLD_ENV }
    for (const k of ['BREVO_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'AFRICASTALKING_API_KEY', 'CHATAPI_INSTANCE_ID', 'CHATAPI_TOKEN', 'CHATWOOT_WHATSAPP_TOKEN']) delete process.env[k]
    jest.spyOn(console, 'log').mockImplementation(() => {})
    mockDb.user.findFirst.mockResolvedValue({ tenantId: 'demo-tenant' })
  })
  afterAll(() => { process.env = OLD_ENV })

  const inv = (id: string, extra: Record<string, unknown> = {}) => ({
    id, number: `FAC-${id}`, totalTTC: 119, dueDate: daysAgo(20), lastReminderSentAt: null,
    client: { id: 'c', name: 'Client', email: 'client@ex.tn', phone: '22333444' },
    tenant: { id: 't1', name: 'Société', email: 'societe@ex.tn' },
    paymentFollowUp: null, reminders: [], ...extra,
  })

  it('un seul canal par facture, statut simulated sans fournisseur, facture récemment relancée ignorée', async () => {
    mockDb.invoice.findMany.mockResolvedValue([
      inv('1'),
      inv('2', { reminders: [{ sentAt: daysAgo(2), response: 'sent' }] }),
      inv('3', { lastReminderSentAt: daysAgo(1) }),
      inv('4', { reminders: [{ sentAt: daysAgo(1), response: 'failed' }], paymentFollowUp: { id: 'f4', nextReminderDate: null } }),
    ])
    const r = await sendAutoReminders('t1', { now: NOW })
    expect(r).toMatchObject({ sent: 0, simulated: 2, failed: 0, skipped: 2 })
    const created = mockDb.paymentReminder.create.mock.calls.map(c => (c[0] as { data: { invoiceId: string; method: string; response: string } }).data)
    expect(created).toEqual([
      expect.objectContaining({ invoiceId: '1', method: 'EMAIL', response: 'simulated' }),
      expect.objectContaining({ invoiceId: '4', method: 'EMAIL', response: 'simulated', followUpId: 'f4' }),
    ])
    // prochaine relance planifiée à +7 j
    const fu = mockDb.paymentFollowUp.update.mock.calls[0][0] as { data: { nextReminderDate: Date } }
    expect(fu.data.nextReminderDate.getTime()).toBe(NOW.getTime() + 7 * 86_400_000)
    // seules les factures (type INVOICE) sont relancées
    expect((mockDb.invoice.findMany.mock.calls[0][0] as { where: { type: string } }).where.type).toBe('INVOICE')
  })

  it('client sans e-mail : WhatsApp en repli (jamais l\'e-mail de la société)', async () => {
    mockDb.invoice.findMany.mockResolvedValue([inv('5', { client: { id: 'c', name: 'C', email: null, phone: '22333444' } })])
    const r = await sendAutoReminders('t1', { now: NOW })
    expect(r.simulated).toBe(1)
    expect((mockDb.paymentReminder.create.mock.calls[0][0] as { data: { method: string } }).data.method).toBe('WHATSAPP')
  })

  it('aucun canal joignable : ignorée avec motif', async () => {
    mockDb.invoice.findMany.mockResolvedValue([inv('6', { client: { id: 'c', name: 'C', email: null, phone: null } })])
    const r = await sendAutoReminders('t1', { now: NOW, methods: ['EMAIL'] })
    expect(r.skipped).toBe(1)
    expect(r.errors[0]).toMatch(/aucun canal joignable/)
    expect(mockDb.paymentReminder.create).not.toHaveBeenCalled()
  })

  it('tenant de démo : simulated même avec un fournisseur configuré', async () => {
    process.env.BREVO_API_KEY = 'x'
    const fetchSpy = jest.spyOn(global, 'fetch' as never)
    mockDb.invoice.findMany.mockResolvedValue([inv('7')])
    const r = await sendAutoReminders('demo-tenant', { now: NOW })
    expect(r.simulated).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('erreur sur une facture : isolée, les suivantes continuent', async () => {
    mockDb.invoice.findMany.mockResolvedValue([inv('8'), inv('9')])
    mockDb.$transaction.mockRejectedValueOnce(new Error('db down'))
    const r = await sendAutoReminders('t1', { now: NOW })
    expect(r.failed).toBe(1)
    expect(r.simulated).toBe(1)
    expect(r.errors[0]).toMatch(/FAC-8: db down/)
  })
})
