import { requireTenant, requireSession, resolveTenantContext } from '@/lib/api-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { Genre, EstadoCivil, SituationFamiliale, TypeContrat, ModePaie } from '@prisma/client'
import * as XLSX from 'xlsx'
import { normalizeFamily } from '@/lib/employee-family'

// Required fields for employee import
const REQUIRED = ['employeeNumber', 'firstName', 'lastName', 'hireDate']
// All supported fields
const OPTIONAL_FIELDS = [
  'email', 'phone', 'cin', 'birthDate', 'birthPlace', 'nationality',
  'genre', 'etatCivil', 'enfantsCharge', 'situationFamiliale', 'chefFamille',
  'address', 'city', 'departement', 'poste', 'qualificationCode',
  'typeContrat', 'salary', 'modePaie', 'banque', 'compteBancaire',
  'cnssNumber', 'cnrpsNumber', 'amoNumber',
]

function toDate(val: any): Date | null {
  if (!val) return null
  if (val instanceof Date) return val
  const d = new Date(val)
  return isNaN(d.getTime()) ? null : d
}

function toNum(val: any, fallback = 0): number {
  if (val === null || val === undefined || val === '') return fallback
  const n = Number(val)
  return isNaN(n) ? fallback : n
}

function normalizeEnum(val: any, allowed: string[]): string {
  if (!val) return allowed[0]
  const s = String(val).toUpperCase().trim()
  return allowed.includes(s) ? s : allowed[0]
}

const GENRE_MAP = ['MALE', 'FEMALE']
const TYPE_CONTRAT_MAP = ['CDI', 'CDD', 'STAGE', 'SAISONNIER', 'INTERIM']
const MODE_PAIE_MAP = ['VIREMENT', 'CHEQUE', 'ESPECE']

export async function POST(req: NextRequest) {
  const session = await requireSession(req)
  if (session instanceof NextResponse) return session
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const tenantCtx = resolveTenantContext(session, formData.get('tenantId') as string | null)
    if ('error' in tenantCtx) return NextResponse.json({ error: tenantCtx.error }, { status: tenantCtx.status })
    const tenantId = tenantCtx.tenantId

    if (!file || !tenantId) {
      return NextResponse.json({ error: 'Fichier et tenantId requis' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' })

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Fichier vide' }, { status: 400 })
    }

    // Build header map (case-insensitive)
    const headers = Object.keys(rows[0])
    const headerMap: Record<string, string> = {}
    headers.forEach(h => { headerMap[h.toLowerCase()] = h })

    // Check required columns
    const missing = REQUIRED.filter(f => !headerMap[f.toLowerCase()])
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Colonnes requises manquantes: ${missing.join(', ')}` },
        { status: 400 }
      )
    }

    // Pre-load qualifications for the tenant
    const qualifications = await prisma.qualification.findMany({
      where: { tenantId },
      select: { id: true, code: true },
    })
    const qualMap: Record<string, string> = {}
    qualifications.forEach(q => { qualMap[q.code.toLowerCase()] = q.id })

    const log: any[] = []
    const errors: any[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      const get = (key: string) => {
        const h = headerMap[key.toLowerCase()]
        return h !== undefined ? row[h] : undefined
      }

      const empNum = String(get('employeeNumber') || '').trim()
      const firstName = String(get('firstName') || '').trim()
      const lastName = String(get('lastName') || '').trim()
      const hireDate = toDate(get('hireDate'))

      if (!empNum || !firstName || !lastName || !hireDate) {
        errors.push({ row: rowNum, error: 'employeeNumber, firstName, lastName ou hireDate manquant' })
        continue
      }

      // Check duplicate
      const existing = await prisma.employee.findUnique({
        where: { tenantId_employeeNumber: { tenantId, employeeNumber: empNum } },
      })
      if (existing) {
        errors.push({ row: rowNum, employeeNumber: empNum, error: 'Matricule déjà utilisé' })
        continue
      }

      // Resolve qualification by code
      const qualCode = String(get('qualificationCode') || '').trim().toLowerCase()
      const qualificationId = qualCode && qualMap[qualCode] ? qualMap[qualCode] : null

      // Situation familiale (paie) : « Marié », « oui »… acceptés ; valeur non reconnue → ligne rejetée
      const family = normalizeFamily({
        etatCivil: get('etatCivil'),
        situationFamiliale: get('situationFamiliale'),
        chefFamille: get('chefFamille'),
        enfantsCharge: get('enfantsCharge'),
      })
      if (family.errors.length) {
        errors.push({ row: rowNum, employeeNumber: empNum, error: family.errors.join(' ; ') })
        continue
      }

      try {
        const employee = await prisma.employee.create({
          data: {
            tenantId,
            employeeNumber: empNum,
            firstName,
            lastName,
            email: String(get('email') || '').trim() || null,
            phone: String(get('phone') || '').trim() || null,
            cin: String(get('cin') || '').trim() || null,
            birthDate: toDate(get('birthDate')),
            birthPlace: String(get('birthPlace') || '').trim() || null,
            nationality: String(get('nationality') || 'Tunisienne').trim(),
            genre: normalizeEnum(get('genre'), GENRE_MAP) as any as Genre,
            etatCivil: family.value.etatCivil as EstadoCivil,
            enfantsCharge: family.value.enfantsCharge,
            situationFamiliale: family.value.situationFamiliale as SituationFamiliale,
            address: String(get('address') || '').trim() || null,
            city: String(get('city') || '').trim() || null,
            hireDate,
            departement: String(get('departement') || '').trim() || null,
            poste: String(get('poste') || '').trim() || null,
            qualificationId,
            typeContrat: normalizeEnum(get('typeContrat'), TYPE_CONTRAT_MAP) as any as TypeContrat,
            salary: toNum(get('salary'), 0),
            modePaie: normalizeEnum(get('modePaie'), MODE_PAIE_MAP) as any as ModePaie,
            banque: String(get('banque') || '').trim() || null,
            compteBancaire: String(get('compteBancaire') || '').trim() || null,
            cnssNumber: String(get('cnssNumber') || '').trim() || null,
            cnrpsNumber: String(get('cnrpsNumber') || '').trim() || null,
            amoNumber: String(get('amoNumber') || '').trim() || null,
          },
        })

        log.push({
          row: rowNum,
          employeeNumber: empNum,
          name: `${firstName} ${lastName}`,
          id: employee.id,
        })
      } catch (e: any) {
        errors.push({ row: rowNum, employeeNumber: empNum, error: e.message })
      }
    }

    return NextResponse.json({
      total: rows.length,
      imported: log.length,
      failed: errors.length,
      log,
      errors,
    })
  } catch (error: any) {
    console.error('Employee import error:', error)
    return NextResponse.json({ error: error.message || 'Erreur serveur' }, { status: 500 })
  }
}