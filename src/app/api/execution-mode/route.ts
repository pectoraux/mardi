import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { getIdentityRepository } from '@/lib/infrastructure/composition/root'
import type { ExecutionMode } from '@/lib/application/ports'

export const GET = withTenant(async (_req, { ctx }) => {
  const identity = getIdentityRepository()
  const tenant = await identity.findTenantById(ctx.tenantId)
  const mode = (tenant as unknown as { executionMode?: string })?.executionMode ?? 'SIMULATION'
  return NextResponse.json({
    executionMode: mode as ExecutionMode,
    modes: [
      { value: 'SIMULATION', label: 'Simulation — no real actions, decisions recorded as simulated' },
      { value: 'SANDBOX', label: 'Sandbox — actions executed against test/sandbox environments' },
      { value: 'LIVE', label: 'Live — real actions with real spend (requires approval + autonomy ≥ 4)' },
    ],
  })
})

export const POST = withTenant(async (req: NextRequest, { ctx }) => {
  const body = await req.json().catch(() => ({}))
  const { executionMode } = (body ?? {}) as { executionMode?: ExecutionMode }
  if (!executionMode || !['SIMULATION', 'SANDBOX', 'LIVE'].includes(executionMode)) {
    return NextResponse.json({ error: 'executionMode must be SIMULATION | SANDBOX | LIVE' }, { status: 400 })
  }
  // LIVE mode requires autonomy ≥ 4 (Section 22)
  if (executionMode === 'LIVE' && ctx.autonomyLevel < 4) {
    return NextResponse.json(
      { error: 'LIVE mode requires autonomy level ≥ 4. Raise the tenant autonomy level first.' },
      { status: 403 }
    )
  }
  const identity = getIdentityRepository()
  await identity.updateTenant(ctx.tenantId, { executionMode })
  return NextResponse.json({ ok: true, executionMode })
})
