import { safeErrorResponse } from '@/lib/security/safe-error'
import { requireTenant } from '@/lib/api-auth'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const type = searchParams.get('type') || 'bilan'

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId requis' }, { status: 400 })
    }

    const dateFilter: any = {}
    if (from) dateFilter.gte = new Date(from)
    if (to) dateFilter.lte = new Date(to + 'T23:59:59')

    const accounts = await prisma.accountingAccount.findMany({
      where: { tenantId, isActive: true },
      orderBy: { accountNumber: 'asc' },
    })

    const lines = await prisma.journalEntryLine.findMany({
      where: {
        journalEntry: {
          tenantId,
          isPosted: true,
          ...(from || to ? { date: dateFilter } : {}),
        },
      },
      include: { account: { select: { accountNumber: true, name: true, type: true } } },
    })

    const getNet = (accountNumber: string): number => {
      const account = accounts.find(a => a.accountNumber === accountNumber)
      if (!account) return 0
      const al = lines.filter(l => l.accountId === account.id)
      const d = al.reduce((s, l) => s + Number(l.debit), 0)
      const c = al.reduce((s, l) => s + Number(l.credit), 0)
      return Number((d - c).toFixed(3))
    }

    const getByPrefix = (prefix: string): number => {
      return accounts
        .filter(a => a.accountNumber.startsWith(prefix))
        .reduce((sum, acc) => {
          const al = lines.filter(l => l.accountId === acc.id)
          const d = al.reduce((s, l) => s + Number(l.debit), 0)
          const c = al.reduce((s, l) => s + Number(l.credit), 0)
          return sum + (d - c)
        }, 0)
    }

    const round = (v: number) => Math.round(v * 1000) / 1000

    if (type === 'cr') {
      // ── COMPTE DE RÉSULTAT ──────────────────────────────────────
      const sales         = round(getByPrefix('70'))
      const production    = round(getByPrefix('71'))
      const varStock      = round(getByPrefix('72'))
      const subsidies     = round(getByPrefix('73'))
      const otherProd     = round(getByPrefix('74'))
      const finProd       = round(getByPrefix('75'))
      const totalProducts = round(sales + production + varStock + subsidies + otherProd + finProd)

      const purchases     = round(getByPrefix('60'))
      const extCharges    = round(getByPrefix('61'))
      const personnel     = round(getByPrefix('63'))
      const finCharges    = round(getByPrefix('66'))
      const depr         = round(getByPrefix('65'))
      const taxes         = round(getByPrefix('64'))
      const otherCharges  = round(getByPrefix('67'))
      const totalCharges  = round(purchases + extCharges + personnel + finCharges + depr + taxes + otherCharges)

      const resultBeforeTax = round(totalProducts - totalCharges)

      return NextResponse.json({
        type: 'COMPTE_DE_RESULTAT',
        tenantId, from, to,
        dateGenerated: new Date().toISOString(),
        charges: {
          purchases, extCharges, personnel,
          finCharges, depr, taxes, otherCharges, totalCharges,
        },
        produits: {
          sales, production, varStock,
          subsidies, otherProd, finProd, totalProducts,
        },
        resultat: { resultAvantImpots: resultBeforeTax, impot: 0, resultatNet: resultBeforeTax },
      })
    }

    if (type === 'ebp') {
      // ── ÉTAT DES FLUX DE TRÉSORERIE ───────────────────────────
      const netResult  = round(getByPrefix('13') - getByPrefix('12') - getByPrefix('14'))
      const amort      = round(getByPrefix('65'))
      const stocks     = round(getByPrefix('31') + getByPrefix('32') + getByPrefix('33') + getByPrefix('35'))
      const clients    = round(getByPrefix('41'))
      const fournisseurs = round(getByPrefix('40'))
      const explCF     = round(netResult + amort + stocks - clients + fournisseurs)

      return NextResponse.json({
        type: 'ETAT_FLUX_TRESORERIE',
        tenantId, from, to,
        dateGenerated: new Date().toISOString(),
        sections: {
          exploitation: {
            resultatNet: netResult, amortissements: amort,
            augmentationStocks: stocks, augmentationClients: -clients,
            augmentationFournisseurs: fournisseurs,
            fluxTresorerieExploitation: explCF,
          },
          investissement: { acquisitionsImmobilisations: 0, cessionsImmobilisations: 0, fluxTresorerieInvestissement: 0 },
          financement:     { augmentationsCapital: 0, dividendesPayes: 0, empruntsRecus: 0, fluxTresorerieFinancement: 0 },
          tresorerieNet: explCF, tresorerieDebut: 0, tresorerieFin: explCF,
        },
      })
    }

    // ── BILAN ────────────────────────────────────────────────────
    const immobilisations = round(getByPrefix('20') + getByPrefix('21') + getByPrefix('22') + getByPrefix('23') + getByPrefix('24'))
    const stocks          = round(getByPrefix('31') + getByPrefix('32') + getByPrefix('33') + getByPrefix('34') + getByPrefix('35'))
    const clients         = round(getByPrefix('41'))
    const autresCreances   = round(getByPrefix('42') + getByPrefix('43') + getByPrefix('44') + getByPrefix('45') + getByPrefix('46'))
    const disponibilites  = round(getByPrefix('50') + getByPrefix('51') + getByPrefix('52') + getByPrefix('53') + getByPrefix('54') + getByPrefix('55') + getByPrefix('56') + getByPrefix('57'))
    const totalActif      = round(immobilisations + stocks + clients + autresCreances + disponibilites)

    const capitauxPropres  = round(getByPrefix('10') + getByPrefix('11') + getByPrefix('12') + getByPrefix('13'))
    const provRisques      = round(getByPrefix('15'))
    const detteFourn       = round(getByPrefix('40'))
    const detteFin         = round(getByPrefix('16'))
    const autresDettes      = round(getByPrefix('42') + getByPrefix('43') + getByPrefix('44') + getByPrefix('45') + getByPrefix('46') + getByPrefix('47') + getByPrefix('48'))
    const totalPassif      = round(capitauxPropres + provRisques + detteFourn + detteFin + autresDettes)

    // Résultat de l'exercice depuis le CR si dispo
    const salesCR   = round(getByPrefix('70'))
    const chargesCR = round(getByPrefix('60') + getByPrefix('61') + getByPrefix('63') + getByPrefix('64') + getByPrefix('65') + getByPrefix('66') + getByPrefix('67'))
    const resultatEx = round(salesCR - chargesCR)

    return NextResponse.json({
      type: 'BILAN',
      tenantId, from, to,
      dateGenerated: new Date().toISOString(),
      actif: {
        immobilisations, stocks, clients,
        autresCreances, disponibilites, totalActif,
      },
      passif: {
        capitauxPropres, provRisques,
        resultatExercice: resultatEx,
        dettesFournisseurs: detteFourn,
        dettesFinancieres: detteFin,
        autresDettes, totalPassif,
      },
      verification: {
        totalActif, totalPassif,
        equilibre: Math.abs(totalActif - totalPassif) < 1,
      },
    })
  } catch (error: any) {
    return safeErrorResponse(error, 'Financial report', 'Génération du rapport financier impossible')
  }
}
