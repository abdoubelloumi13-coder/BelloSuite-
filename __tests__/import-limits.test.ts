/**
 * @jest-environment node
 */
/* Audit M2/M4 : bornes des imports et messages d'erreur non techniques. */
import * as XLSX from 'xlsx'
import { importFileError, readImportRows, safeErrorMessage, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '@/lib/security/import-limits'
import { BusinessError } from '@/lib/errors'

function csvFile(lines: number, name = 'a.csv'): File {
  const body = ['code,name', ...Array.from({ length: lines }, (_, i) => `C${i},N${i}`)].join('\n')
  return new File([body], name, { type: 'text/csv' })
}

describe('importFileError', () => {
  it('refuse absent, vide, trop gros, mauvaise extension', () => {
    expect(importFileError(null)).toMatch(/requis/)
    expect(importFileError({ name: 'a.xlsx', size: 0 })).toMatch(/vide/)
    expect(importFileError({ name: 'a.xlsx', size: MAX_IMPORT_BYTES + 1 })).toMatch(/5 Mo/)
    expect(importFileError({ name: 'a.exe', size: 10 })).toMatch(/Format/)
    expect(importFileError({ name: 'a.XLSX', size: 10 })).toBeNull()
  })
})

describe('readImportRows', () => {
  it('lit un CSV normal', async () => {
    const rows = await readImportRows(csvFile(3))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ code: 'C0', name: 'N0' })
  })
  it('refuse au-delà de la borne de lignes', async () => {
    await expect(readImportRows(csvFile(MAX_IMPORT_ROWS + 10))).rejects.toThrow(/Trop de lignes/)
  })
  it('accepte exactement la borne', async () => {
    expect(await readImportRows(csvFile(MAX_IMPORT_ROWS))).toHaveLength(MAX_IMPORT_ROWS)
  })
  void XLSX
})

describe('safeErrorMessage', () => {
  it('ne révèle jamais un message Prisma', () => {
    const prismaErr = Object.assign(new Error('Unique constraint failed on the fields: (`tenantId`,`code`) in table "Client"'), { code: 'P2002' })
    expect(safeErrorMessage(prismaErr)).toBe('Doublon : cette valeur existe déjà')
    expect(safeErrorMessage(new Error('Invalid `prisma.client.create()` invocation: column "x"'))).toBe('Ligne invalide')
    expect(safeErrorMessage(new BusinessError('Code requis'))).toBe('Code requis')
  })
})
