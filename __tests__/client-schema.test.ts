jest.mock('@/lib/db', () => ({ prisma: {} }))

import { createClientSchema, updateClientSchema } from '@/services/clients'
import { createSupplierSchema } from '@/services/suppliers'

describe('createClientSchema — champs vides du formulaire', () => {
  const blank = { tenantId: 't1', name: 'X', code: 'CLT-1234', email: '', phone: '', address: '', city: '', zipCode: '', matriculeFiscal: '', country: '' }

  it('accepte les champs optionnels vides et les convertit en null', () => {
    const r = createClientSchema.safeParse(blank)
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.email).toBeNull()
    expect(r.data.phone).toBeNull()
    expect(r.data.code).toBe('CLT-1234')
    expect(r.data.country).toBe('Tunisie')
  })

  it('refuse un e-mail invalide et un nom vide', () => {
    expect(createClientSchema.safeParse({ ...blank, email: 'pas-un-mail' }).success).toBe(false)
    expect(createClientSchema.safeParse({ ...blank, name: '  ' }).success).toBe(false)
  })

  it('mise à jour : e-mail vide → null', () => {
    const r = updateClientSchema.safeParse({ email: '' })
    expect(r.success && r.data.email).toBeNull()
  })

  it('fournisseur : champs vides acceptés', () => {
    const r = createSupplierSchema.safeParse({ ...blank, code: 'FRS-1' })
    expect(r.success).toBe(true)
  })
})
