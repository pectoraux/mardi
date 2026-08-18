import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { getTenantContext } from '@/lib/tenant-context'
import { rawDb as db } from '@/lib/tenant-guard'

export const GET = withTenant(async (_req, _ctx) => {
  const ctx = getTenantContext()
  const policies = await t.policy.findMany({})
  return NextResponse.json({
    autonomyLevel: ctx.autonomyLevel,
    region: ctx.region,
    roles: ctx.roles,
    environment: ctx.environment,
    policies: policies.map((p) => ({
      id: p.id,
      name: p.name,
      maxSpendChangePct: p.maxSpendChangePct,
      allowedChannels: p.allowedChannels.split(','),
      allowedActions: p.allowedActions.split(','),
      requiresApproval: p.requiresApproval,
      riskThreshold: p.riskThreshold,
      operatingHours: p.operatingHours,
    })),
    levels: [
      { level: 0, label: 'AI analyzes only' },
      { level: 1, label: 'AI recommends' },
      { level: 2, label: 'AI creates drafts' },
      { level: 3, label: 'AI can execute low-risk experiments' },
      { level: 4, label: 'AI can make bounded budget changes' },
      { level: 5, label: 'AI can autonomously optimize within policies' },
    ],
  })
})

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  if (typeof body.autonomyLevel !== 'number') {
    return NextResponse.json({ error: 'autonomyLevel required' }, { status: 400 })
  }
  const ctx = getTenantContext()
  // Update tenant autonomy directly (enterprise tenants could scope per-policy).
  await db.tenant.update({
    where: { id: ctx.tenantId },
    data: { autonomyLevel: body.autonomyLevel },
  })
  // Invalidate cache so subsequent requests see the new value.
  const { invalidateTenantCache } = await import('@/lib/tenant-context')
  invalidateTenantCache()
  return NextResponse.json({ ok: true, autonomyLevel: body.autonomyLevel })
})
