import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { recordDecision, recordDecisionOutcome } from '@/lib/intelligence/decision-engine'

export const GET = withTenant(async (_req, _ctx) => {
  const decisions = await t.decision.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { approvals: true } as never,
  })
  return NextResponse.json({
    decisions: decisions.map((d) => ({
      id: d.id,
      objective: d.objective,
      recommendation: d.recommendation,
      evidence: d.evidence ? JSON.parse(d.evidence) : [],
      modelsUsed: d.modelsUsed ? JSON.parse(d.modelsUsed) : [],
      assumptions: d.assumptions ? JSON.parse(d.assumptions) : [],
      expectedOutcome: d.expectedOutcome ? JSON.parse(d.expectedOutcome) : null,
      actualOutcome: d.actualOutcome ? JSON.parse(d.actualOutcome) : null,
      confidence: d.confidence,
      actionTaken: d.actionTaken,
      learning: d.learning,
      status: d.status,
      createdAt: d.createdAt,
      recommendationId: d.recommendationId,
      approvals: (d as unknown as { approvals?: unknown[] }).approvals ?? [],
    })),
  })
})

export const POST = withTenant(async (req: NextRequest, { ctx }) => {
  const body = await req.json().catch(() => ({}))
  if (body.action === 'outcome') {
    const out = await recordDecisionOutcome(body.decisionId, {
      actualOutcome: body.actualOutcome,
      learning: body.learning,
    })
    return NextResponse.json({ ok: true, id: out.id })
  }
  const out = await recordDecision({
    recommendationId: body.recommendationId,
    objective: body.objective ?? 'Allocate marketing capital to maximize incremental profit',
    approverEmail: body.approverEmail ?? `${ctx.roles.join(',')}@${ctx.tenantSlug}.example`,
    actionTaken: body.actionTaken ?? 'approved for execution',
    assumptions: body.assumptions,
    expectedOutcome: body.expectedOutcome,
  })
  return NextResponse.json({ ok: true, ...out })
})
