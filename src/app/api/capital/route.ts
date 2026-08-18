import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { getRepository } from '@/lib/infrastructure/composition/root'
import { createCapitalAllocationService } from '@/lib/domain/services/capital-allocation'

export const GET = withTenant(async (_req, { ctx }) => {
  const repo = getRepository()
  const service = createCapitalAllocationService(repo)
  const strategy = await service.getZeroCapitalStrategy(ctx)
  return NextResponse.json(strategy)
})

export const POST = withTenant(async (req: NextRequest, { ctx }) => {
  const repo = getRepository()
  const service = createCapitalAllocationService(repo)
  const body = await req.json().catch(() => ({}))
  const { type, amount, source, referenceType, referenceId, description } = (body ?? {}) as {
    type: 'AVAILABLE' | 'COMMITTED' | 'SPENT' | 'EXPECTED_RETURN' | 'REALIZED_RETURN' | 'REINVESTMENT'
    amount: number
    source: string
    referenceType?: string
    referenceId?: string
    description?: string
  }
  if (!type || amount === undefined || !source) {
    return NextResponse.json({ error: 'type, amount, source required' }, { status: 400 })
  }
  await service.recordCapital(ctx, { type, amount, source, referenceType, referenceId, description })
  const strategy = await service.getZeroCapitalStrategy(ctx)
  return NextResponse.json({ ok: true, ...strategy })
})
