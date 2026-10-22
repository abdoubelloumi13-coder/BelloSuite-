import { safeErrorResponse } from '@/lib/security/safe-error'
import { requireAccess } from '@/lib/rbac'
import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from "@/lib/db";
import { TUNISIAN_CHART_OF_ACCOUNTS } from '@/lib/tunisian-chart-of-accounts'


export async function POST(request: Request) {
  try {
    const { tenantId: requestedTenantId } = await request.json()
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'accounting:write')
    if (accessDenied) return accessDenied
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant ID is required' }, { status: 400 })
    }

    // Check if accounts already exist
    const existingCount = await prisma.accountingAccount.count({
      where: { tenantId }
    })

    if (existingCount > 0) {
      return NextResponse.json({ message: 'Chart of accounts already initialized for this tenant.' }, { status: 400 })
    }

    // Sort accounts by length so parents are created first
    const sortedAccounts = [...TUNISIAN_CHART_OF_ACCOUNTS].sort((a, b) => a.accountNumber.length - b.accountNumber.length)

    const accountMapping = new Map<string, string>() // Maps accountNumber to database UUID

    // It's safer to create them sequentially to hook up parentId correctly
    for (const acc of sortedAccounts) {
      // Find parent accountNumber by progressively chopping the last character
      let parentId = null
      for (let i = acc.accountNumber.length - 1; i > 0; i--) {
        const parentAccNum = acc.accountNumber.substring(0, i)
        if (accountMapping.has(parentAccNum)) {
          parentId = accountMapping.get(parentAccNum)
          break
        }
      }

      const created = await prisma.accountingAccount.create({
        data: {
          tenantId,
          accountNumber: acc.accountNumber,
          name: acc.name,
          type: acc.type,
          parentId
        }
      })
      accountMapping.set(acc.accountNumber, created.id)
    }

    return NextResponse.json({ message: 'Tunisian Chart of Accounts initialized successfully.', count: sortedAccounts.length })
  } catch (error: any) {
    return safeErrorResponse(error, 'Accounting Init', 'Initialisation de la comptabilité impossible')
  }
}
