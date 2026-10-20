/**
 * @jest-environment node
 */
import {
  generateInviteCode, normalizeInviteCode, hashInviteCode, inviteState, taxpayerKind, monthlyDeclarationDeadline,
  previousPeriod, periodFigures, clientAlerts, clientPriority, journalToCsv, registerToCsv, csvAmount, monthRange,
} from '@/lib/firm-logic'

describe('codes d’invitation cabinet', () => {
  it('format XXXX-XXXX sans caractères ambigus', () => {
    for (let i = 0; i < 50; i++) {
      const c = generateInviteCode()
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/)
    }
  })
  it('normalise la saisie et refuse un format impossible', () => {
    expect(normalizeInviteCode(' abcd-efgh ')).toBe('ABCDEFGH')
    expect(normalizeInviteCode('ABCD-EFG0')).toBeNull() // 0 exclu
    expect(normalizeInviteCode('ABC')).toBeNull()
  })
  it('hachage stable, insensible au tiret et à la casse', () => {
    expect(hashInviteCode('abcd-efgh')).toBe(hashInviteCode('ABCDEFGH'))
    expect(hashInviteCode('ABCD-EFGH')).not.toBe(hashInviteCode('ABCD-EFGJ'))
    expect(hashInviteCode('ABCDEFGH')).toMatch(/^[0-9a-f]{64}$/)
  })
  it('usage unique et expiration', () => {
    const now = new Date('2026-10-20T10:00:00Z')
    expect(inviteState({ expiresAt: '2026-10-27T10:00:00Z' }, now)).toBe('OK')
    expect(inviteState({ expiresAt: '2026-10-20T09:00:00Z' }, now)).toBe('EXPIRED')
    expect(inviteState({ expiresAt: '2026-10-27T10:00:00Z', usedAt: now }, now)).toBe('USED')
  })
})

describe('échéances des déclarations mensuelles', () => {
  it('nature du contribuable d’après le matricule', () => {
    expect(taxpayerKind('1234567A/A/M/000')).toBe('PM')
    expect(taxpayerKind('1234567AAM000')).toBe('PM')
    expect(taxpayerKind('1234567B/A/P/000')).toBe('PP')
    expect(taxpayerKind('1234567A')).toBeNull()
    expect(taxpayerKind(null)).toBeNull()
  })
  it('15 pour PP, 20 pour PM en télédéclaration, 28 sur papier', () => {
    expect(monthlyDeclarationDeadline(2026, 9, 'PP').toISOString().slice(0, 10)).toBe('2026-10-15')
    expect(monthlyDeclarationDeadline(2026, 9, 'PM').toISOString().slice(0, 10)).toBe('2026-10-20')
    expect(monthlyDeclarationDeadline(2026, 9, 'PM', { eFiling: false }).toISOString().slice(0, 10)).toBe('2026-10-28')
    expect(monthlyDeclarationDeadline(2026, 12, 'PP').toISOString().slice(0, 10)).toBe('2027-01-15')
    expect(monthlyDeclarationDeadline(2026, 9, null).toISOString().slice(0, 10)).toBe('2026-10-15')
  })
  it('un dimanche reporte au lundi (15 novembre 2026 = dimanche)', () => {
    expect(monthlyDeclarationDeadline(2026, 10, 'PP').toISOString().slice(0, 10)).toBe('2026-11-16')
  })
  it('période précédente', () => {
    expect(previousPeriod(new Date('2026-01-10T00:00:00Z'))).toEqual({ year: 2025, month: 12 })
    expect(previousPeriod(new Date('2026-10-20T00:00:00Z'))).toEqual({ year: 2026, month: 9 })
    expect(monthRange(2026, 12).lt.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('indicateurs par dossier', () => {
  const sales = [
    { type: 'INVOICE', status: 'SENT', subtotalHT: '1000', totalVAT: '190', totalTTC: '1191' },
    { type: 'INVOICE', status: 'DRAFT', subtotalHT: '999', totalVAT: '1', totalTTC: '1000' },
    { type: 'CREDIT_NOTE', status: 'CONFIRMED', subtotalHT: '100', totalVAT: '19', totalTTC: '119' },
    { type: 'QUOTE', status: 'SENT', subtotalHT: '5000', totalVAT: '950', totalTTC: '5950' },
  ]
  const purchases = [
    { status: 'VALIDATED', subtotal: 500, taxAmount: 95, total: 596 },
    { status: 'CANCELLED', subtotal: 1, taxAmount: 1, total: 1 },
  ]
  const rs = [
    { taxAmount: 15, beneficiaryTin: '1234567A', beneficiaryAddress: 'Tunis', beneficiaryEmail: 'a@b.tn', beneficiaryPhone: '22123456', paymentDate: '2026-09-10' },
    { taxAmount: 30, beneficiaryTin: '1234567B', beneficiaryAddress: null, beneficiaryEmail: null, beneficiaryPhone: null, paymentDate: null },
  ]
  it('ignore brouillons, devis et annulées ; déduit les avoirs', () => {
    const f = periodFigures(sales, purchases, rs)
    expect(f).toMatchObject({ salesCount: 1, salesHT: 900, vatCollected: 171, purchasesCount: 1, purchasesHT: 500, vatDeductible: 95, vatNet: 76, rsCount: 2, rsAmount: 45, rsIncomplete: 1 })
  })
  it('alertes : échéance proche, RS incomplète, pièces à traiter, priorité', () => {
    const previous = periodFigures(sales, purchases, rs)
    const r = clientAlerts({ matriculeFiscal: '1234567A/A/M/000', previous, scansToReview: 3, now: new Date('2026-10-18T08:00:00Z') })
    expect(r.deadline).toBe('2026-10-20')
    expect(r.daysLeft).toBe(2)
    expect(r.alerts.map(a => a.code)).toEqual(['DECLARATION_DUE', 'RS_INCOMPLETE', 'SCANS_TO_REVIEW'])
    expect(r.alerts[0].level).toBe('danger')
    const late = clientAlerts({ matriculeFiscal: null, previous, scansToReview: 0, now: new Date('2026-10-18T08:00:00Z') })
    expect(late.alerts[0]).toMatchObject({ code: 'DECLARATION_LATE', value: 3 })
    expect(late.alerts.some(a => a.code === 'NO_MF')).toBe(true)
    expect(clientPriority(late)).toBeGreaterThan(clientPriority({ alerts: [{ code: 'SCANS_TO_REVIEW', level: 'info' }] }))
    const filed = clientAlerts({ matriculeFiscal: null, previous, scansToReview: 0, declarationFiled: true, now: new Date('2026-10-18T08:00:00Z') })
    expect(filed.alerts.some(a => a.code.startsWith('DECLARATION'))).toBe(false)
  })
})

describe('exports CSV pour le logiciel du cabinet', () => {
  it('montants au millime, virgule décimale', () => {
    expect(csvAmount('1250.5')).toBe('1250,500')
    expect(csvAmount(null)).toBe('0,000')
  })
  it('journal : BOM, « ; », une ligne par mouvement, échappement', () => {
    const csv = journalToCsv([{
      date: '2026-09-05T00:00:00Z', entryNumber: 'ACH-0001', reference: 'F;12', description: 'Achat "SOTUVER"',
      journal: { code: 'ACH' },
      lines: [
        { debit: 1000, credit: 0, account: { accountNumber: '607', name: 'Achats de marchandises' } },
        { debit: 0, credit: 1000, description: '=HYPERLINK("x")', account: { accountNumber: '401', name: 'Fournisseurs' } },
      ],
    }])
    expect(csv.startsWith('\uFEFFDate;Journal;')).toBe(true)
    const rows = csv.trim().split('\r\n')
    expect(rows).toHaveLength(3)
    expect(rows[1]).toBe('05/09/2026;ACH;ACH-0001;"F;12";607;Achats de marchandises;"Achat ""SOTUVER""";1000,000;0,000')
    expect(rows[2]).toContain(`"'=HYPERLINK(""x"")"`) // formule neutralisée
  })
  it('registre trié par date, avoirs négatifs conservés', () => {
    const csv = registerToCsv([
      { kind: 'ACHAT', date: '2026-09-20', number: 'F-9', partyName: 'Fournisseur', ht: 100, vat: 19, ttc: 120, stamp: 1 },
      { kind: 'VENTE', date: '2026-09-02', number: 'AV-1', partyName: 'Client', partyMf: '1234567A', ht: -50, vat: -9.5, ttc: -59.5 },
    ])
    const rows = csv.trim().split('\r\n')
    expect(rows[1].startsWith('VENTE;02/09/2026;AV-1;Client;1234567A;-50,000')).toBe(true)
    expect(rows[2]).toContain('ACHAT;20/09/2026;F-9')
  })
})
