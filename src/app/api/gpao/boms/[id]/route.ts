import { requireTenant } from '@/lib/api-auth'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { tenantRefsError } from '@/lib/tenant-scope'
import { parseBody } from '@/lib/api'
import { bomUpdateSchema } from '@/lib/security/update-schemas'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    const bom = await prisma.billOfMaterials.findFirst({
      where: { 
        id,
        tenantId,
      },
      include: {
        items: true
      }
    })

    if (!bom) {
      return NextResponse.json({ error: 'BOM not found' }, { status: 404 })
    }

    return NextResponse.json(bom)
  } catch (error) {
    console.error('Error fetching BOM:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let body: unknown
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Body JSON invalide' }, { status: 400 }) }
    // Liste blanche (pas de tenant/product connect imbriqué, pas de clé inconnue)
    const parsed = parseBody(bomUpdateSchema, body)
    if (parsed instanceof NextResponse) return parsed
    const { tenantId: requestedTenantId, items, ...updateData } = parsed
    const ctx = await requireTenant(request, requestedTenantId)
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }
    const badRef = await tenantRefsError(tenantId, {
      product: [updateData.productId, ...(items ? items.map(i => i.productId) : [])],
    })
    if (badRef) return badRef

    // Update the BOM and recreate the items
    const bom = await prisma.billOfMaterials.update({
      where: {
        id,
        tenantId,
      },
      data: {
        ...updateData,
        ...(items && {
          items: {
            deleteMany: {}, // Delete old items
            create: items.map(item => ({
              productId: item.productId,
              quantity: item.quantity
            }))
          }
        })
      },
      include: {
        items: true
      }
    })

    return NextResponse.json(bom)
  } catch (error) {
    console.error('Error updating BOM:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url)
    const ctx = await requireTenant(request, searchParams.get('tenantId'))
    if (ctx instanceof NextResponse) return ctx
    const tenantId = ctx.tenantId

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId required' }, { status: 400 })
    }

    await prisma.billOfMaterials.delete({
      where: {
        id,
        tenantId,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting BOM:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
