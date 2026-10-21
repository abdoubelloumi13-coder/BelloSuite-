import { requireSuperAdmin } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { logAudit, clientIp } from '@/lib/super-admin-audit'
import { Prisma } from '@prisma/client'
import { invalidateIdentityCache } from '@/lib/session-guard'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true, createdAt: true } },
        modules: { include: { module: true } }
      }
    })
    if (!tenant) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(tenant)
  } catch (error) {
    return NextResponse.json({ error: 'Error' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    const body = await req.json()
    const { isActive, name, email, phone, city, address } = body

    const before = await prisma.tenant.findUnique({ where: { id }, select: { isActive: true, name: true } })
    if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const tenant = await prisma.tenant.update({
      where: { id },
      data: { isActive, name, email, phone, city, address }
    })
    invalidateIdentityCache({ tenantId: id })

    if (isActive !== undefined && isActive !== before.isActive) {
      await logAudit(auth.id, isActive ? 'TENANT_ACTIVATE' : 'TENANT_SUSPEND', {
        target: 'tenant', targetId: id, tenantId: id,
        details: { from: before.isActive, to: isActive }, ip: clientIp(req),
      })
    }
    return NextResponse.json(tenant)
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update tenant' }, { status: 500 })
  }
}

/**
 * Suppression d'un tenant. Deux modes :
 *  - { mode: 'soft' } (défaut) : désactive le tenant et tous ses users (récupérable)
 *  - { mode: 'hard' } : suppression physique des données (IRREVERSIBLE)
 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth
  try {
    const { id } = await params
    const { mode = 'soft' } = await req.json().catch(() => ({}))

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, subdomain: true },
    })
    if (!tenant) return NextResponse.json({ error: 'Tenant introuvable' }, { status: 404 })

    if (mode === 'hard') {
      try {
        // Tentative de suppression en cascade explicite : users + tenant.
        // Les autres tables (products, invoices, etc.) ont des FK vers tenantId
        // sans onDelete: Cascade -> Prisma lancera P2003.
        // On capture l'erreur pour la rendre compréhensible.
        await prisma.user.deleteMany({ where: { tenantId: id } })
        await prisma.tenant.delete({ where: { id } })
        await logAudit(auth.id, 'TENANT_DELETE_HARD', {
          target: 'tenant', targetId: id, tenantId: id,
          details: { name: tenant.name, subdomain: tenant.subdomain }, ip: clientIp(req),
        })
        return NextResponse.json({ success: true, mode: 'hard' })
      } catch (err: any) {
        // Prisma P2003 = Foreign key constraint failed (d'autres tables enfant bloquent la suppression)
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          return NextResponse.json({
            error: 'Suppression impossible : des données liées existent encore (produits, factures, employés, etc.). Utilisez le mode « Suspendre » (soft delete) ou supprimez manuellement les données liées avant.'
          }, { status: 409 })
        }
        throw err
      }
    }

    // Soft : on désactive le tenant + ses users (les données restent, récupérables)
    await prisma.tenant.update({ where: { id }, data: { isActive: false } })
    await prisma.user.updateMany({ where: { tenantId: id }, data: { isActive: false } })
    invalidateIdentityCache() // tenant + tous ses utilisateurs
    await logAudit(auth.id, 'TENANT_SUSPEND', {
      target: 'tenant', targetId: id, tenantId: id,
      details: { name: tenant.name, subdomain: tenant.subdomain, soft: true }, ip: clientIp(req),
    })
    return NextResponse.json({ success: true, mode: 'soft' })
  } catch (error) {
    console.error('[super-admin] DELETE tenant error', error)
    return NextResponse.json({ error: 'Failed to delete tenant' }, { status: 500 })
  }
}
