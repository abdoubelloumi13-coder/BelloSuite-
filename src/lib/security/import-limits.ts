/**
 * Bornes des imports de fichiers (audit M2) et messages d'erreur non techniques (audit M4).
 *  - 5 Mo maximum, extensions .xlsx / .xls / .csv uniquement ;
 *  - 5 000 lignes maximum (lecture XLSX elle-même bornée via `sheetRows`, pas seulement après coup) ;
 *  - jamais de message Prisma brut renvoyé au client (tables, colonnes, contraintes).
 */
import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { BusinessError } from '@/lib/errors'

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5000
const ALLOWED_EXT = /\.(xlsx|xls|csv)$/i

/** Message d'erreur (fr) si le fichier est absent, trop gros ou d'un type non accepté ; sinon null. */
export function importFileError(file: { name?: string; size: number } | null | undefined): string | null {
  if (!file) return 'Fichier requis'
  if (!file.size) return 'Fichier vide'
  if (file.size > MAX_IMPORT_BYTES) return `Fichier trop volumineux (5 Mo maximum)`
  if (file.name && !ALLOWED_EXT.test(file.name)) return 'Format non accepté : fichier Excel (.xlsx, .xls) ou CSV attendu'
  return null
}

/** Lit la 1re feuille en objets (en-têtes en 1re ligne). Lève BusinessError(400/413) si hors bornes. */
export async function readImportRows(file: File): Promise<any[]> {
  const err = importFileError(file)
  if (err) throw new BusinessError(err, file && file.size > MAX_IMPORT_BYTES ? 413 : 400)
  const buffer = Buffer.from(await file.arrayBuffer())
  let rows: any[]
  try {
    // sheetRows : en-tête + MAX + 1 ligne témoin pour détecter le dépassement sans tout décoder
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, sheetRows: MAX_IMPORT_ROWS + 2 })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) throw new Error('no sheet')
    rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  } catch {
    throw new BusinessError('Fichier illisible : vérifiez le format (Excel ou CSV)', 400)
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new BusinessError(`Trop de lignes : ${MAX_IMPORT_ROWS} maximum par import`, 413)
  }
  return rows
}

/** Message de ligne sûr : message métier conservé, erreurs Prisma/techniques traduites sans détail interne. */
export function safeErrorMessage(e: unknown): string {
  if (e instanceof BusinessError) return e.message
  const code = (e as { code?: unknown })?.code
  if (code === 'P2002') return 'Doublon : cette valeur existe déjà'
  if (code === 'P2003' || code === 'P2025') return 'Référence invalide ou introuvable'
  if (code === 'P2000') return 'Valeur trop longue'
  if ((e as { name?: string })?.name === 'ZodError') return 'Données invalides'
  return 'Ligne invalide'
}

/** Réponse d'erreur d'un import : message métier (BusinessError) ou générique, détail seulement dans les logs. */
export function importErrorResponse(error: unknown, operation: string): NextResponse {
  console.error(`${operation} error:`, error)
  if (error instanceof BusinessError) {
    return NextResponse.json({ ...(error.details ?? {}), error: error.message }, { status: error.statusCode })
  }
  return NextResponse.json({ error: 'Erreur serveur : import impossible' }, { status: 500 })
}
