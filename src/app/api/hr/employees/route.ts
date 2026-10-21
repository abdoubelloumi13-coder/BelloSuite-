import { requireAccess } from '@/lib/rbac'
import { NextRequest, NextResponse } from 'next/server'
import { getApiContext, parseBody } from '@/lib/api'
import { handleApiError } from '@/lib/errors'
import { getEmployees, createEmployee, createEmployeeSchema } from '@/services/hr'

// GET /api/hr/employees?tenantId=&isActive=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenantId')
    const isActiveParam = searchParams.get('isActive')
    const isActive = isActiveParam !== null ? isActiveParam === 'true' : undefined

    const ctx = await getApiContext(req, tenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:read')
    if (accessDenied) return accessDenied

    const employees = await getEmployees(ctx.tenantId, isActive)
    return NextResponse.json(employees)
  } catch (err) {
    return handleApiError(err, 'GET employees')
  }
}

// POST /api/hr/employees
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ctx = await getApiContext(req, body?.tenantId)
    if (ctx instanceof NextResponse) return ctx
    const accessDenied = requireAccess(ctx, 'hr:write')
    if (accessDenied) return accessDenied

    const data = parseBody(createEmployeeSchema, { ...body, tenantId: ctx.tenantId })
    if (data instanceof NextResponse) return data

    const employee = await createEmployee(data)
    return NextResponse.json(employee, { status: 201 })
  } catch (err) {
    return handleApiError(err, 'POST employee')
  }
}
