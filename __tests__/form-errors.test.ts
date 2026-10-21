/**
 * Formulaires stock : une réponse non-OK n'est jamais muette (src/lib/form-errors.ts)
 * + schéma de création d'article tolérant (catégorie libre, unité vide, fodec chaîne).
 */
import { apiFormError, zodIssueToFrench } from '@/lib/form-errors'
import { createProductSchema } from '@/lib/stock-api'

describe('apiFormError', () => {
  it('400 zod → erreurs par champ en français + bannière', () => {
    const fe = apiFormError(400, { error: 'Données invalides', details: [
      { code: 'too_small', type: 'string', minimum: 1, path: ['name'], message: 'String must contain at least 1 character(s)' },
      { code: 'invalid_type', expected: 'number', path: ['salePrice'], message: 'Expected number' },
      { code: 'too_small', type: 'string', minimum: 1, path: ['tenantId'], message: 'x' },
    ] }, { name: 'Nom' })
    expect(fe.fields).toEqual({ name: 'Champ obligatoire', salePrice: 'Nombre attendu' })
    expect(fe.message).toContain('Nom : Champ obligatoire')
    expect(fe.fields.tenantId).toBeUndefined()
  })
  it('garde un message zod déjà français', () => {
    expect(zodIssueToFrench({ code: 'too_small', message: 'Code requis' })).toBe('Code requis')
  })
  it('403 / 401 / 0 / 500 → messages explicites', () => {
    expect(apiFormError(403, { error: 'Forbidden' }).message).toMatch(/Droits insuffisants/)
    expect(apiFormError(403, { error: 'Droits insuffisants : seul un administrateur peut créer un dépôt.' }).message).toMatch(/créer un dépôt/)
    expect(apiFormError(401, null).message).toMatch(/session a expiré/)
    expect(apiFormError(0, null).message).toMatch(/Connexion au serveur/)
    expect(apiFormError(500, null).message).toMatch(/Erreur serveur \(500\)/)
    expect(apiFormError(500, { error: 'La base de données n\'est pas à jour', code: 'DB_SCHEMA_DRIFT' }).message).toMatch(/pas à jour/)
  })
  it('409 → conflit lisible', () => {
    expect(apiFormError(409, { error: 'Ce code existe déjà' }).message).toBe('Ce code existe déjà')
  })
})

describe('createProductSchema', () => {
  it('accepte catégorie libre, unité vide, prix vides, fodec "false"', () => {
    const r = createProductSchema.safeParse({ tenantId: 't', code: ' AUDIT-001 ', name: 'Article Audit', category: 'Audit', unit: '', purchasePrice: '', salePrice: '25', fodec: 'false', initialStock: '50', warehouseId: '' })
    expect(r.success).toBe(true)
    if (r.success) { expect(r.data.code).toBe('AUDIT-001'); expect(r.data.unit).toBe('unit'); expect(r.data.fodec).toBe(false); expect(r.data.category).toBe('Audit') }
  })
  it('refuse un nom vide avec un message français', () => {
    const r = createProductSchema.safeParse({ tenantId: 't', code: 'A', name: '  ' })
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error.issues[0].message).toBe('Nom requis')
  })
})
