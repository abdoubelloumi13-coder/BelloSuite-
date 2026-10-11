/** Sélection du fournisseur email (SMTP Gmail / Resend / aucun) et envoi (transports simulés). */
const sendMailMock = jest.fn()
const createTransport = jest.fn(() => ({ sendMail: sendMailMock }))
jest.mock('nodemailer', () => ({ __esModule: true, default: { createTransport: (...a: unknown[]) => (createTransport as jest.Mock)(...a) } }))

import { selectMailProvider, sendMail } from '@/lib/mailer'

const SMTP = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'me@gmail.com', SMTP_PASS: 'app-pass' }
const msg = { to: ['a@x.tn', ' a@x.tn ', ''], subject: 'S', html: '<p>h</p>', text: 'h' }
const realFetch = global.fetch

afterEach(() => { global.fetch = realFetch; jest.clearAllMocks() })

describe('selectMailProvider', () => {
  it('SMTP prioritaire, puis Resend, sinon none', () => {
    expect(selectMailProvider({ ...SMTP, RESEND_API_KEY: 'k' })).toBe('smtp')
    expect(selectMailProvider({ RESEND_API_KEY: 'k' })).toBe('resend')
    expect(selectMailProvider({ SMTP_HOST: 'h', SMTP_USER: 'u' })).toBe('none')
    expect(selectMailProvider({})).toBe('none')
  })
  it('MAIL_PROVIDER force le choix (et retombe sur none si incomplet)', () => {
    expect(selectMailProvider({ ...SMTP, RESEND_API_KEY: 'k', MAIL_PROVIDER: 'resend' })).toBe('resend')
    expect(selectMailProvider({ ...SMTP, MAIL_PROVIDER: 'none' })).toBe('none')
    expect(selectMailProvider({ RESEND_API_KEY: 'k', MAIL_PROVIDER: 'smtp' })).toBe('none')
  })
})

describe('sendMail', () => {
  it('none : n’envoie rien', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch
    const r = await sendMail(msg, {})
    expect(r).toMatchObject({ provider: 'none', ok: false })
    expect(global.fetch).not.toHaveBeenCalled()
    expect(createTransport).not.toHaveBeenCalled()
  })
  it('SMTP : nodemailer avec destinataires dédoublonnés, port 465 = secure', async () => {
    sendMailMock.mockResolvedValue({ messageId: 'm1' })
    const r = await sendMail(msg, { ...SMTP, SMTP_PORT: '465', MAIL_FROM: 'BelloSuite <me@gmail.com>' })
    expect(r).toEqual({ provider: 'smtp', ok: true, id: 'm1' })
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true }))
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.tn', from: 'BelloSuite <me@gmail.com>', subject: 'S' }))
  })
  it('SMTP : erreur remontée sans exception', async () => {
    sendMailMock.mockRejectedValue(new Error('auth failed'))
    expect(await sendMail(msg, SMTP)).toEqual({ provider: 'smtp', ok: false, error: 'auth failed' })
  })
  it('Resend : POST API avec la clé, erreur HTTP gérée', async () => {
    const f = jest.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'r1' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({ message: 'domain not verified' }) })
    global.fetch = f as unknown as typeof fetch
    expect(await sendMail(msg, { RESEND_API_KEY: 'key' })).toEqual({ provider: 'resend', ok: true, id: 'r1' })
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.Authorization).toBe('Bearer key')
    expect(JSON.parse(init.body)).toMatchObject({ to: ['a@x.tn'], subject: 'S' })
    expect(await sendMail(msg, { RESEND_API_KEY: 'key' })).toEqual({ provider: 'resend', ok: false, error: 'domain not verified' })
  })
  it('aucun destinataire', async () => {
    expect(await sendMail({ ...msg, to: [' '] }, SMTP)).toMatchObject({ ok: false, error: 'Aucun destinataire' })
  })
})
