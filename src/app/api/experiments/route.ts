import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { createExperiment, completeExperiment } from '@/lib/intelligence/experiment'

export const GET = withTenant(async (_req, _ctx) => {
  const experiments = await t.experiment.findMany({
    orderBy: { createdAt: 'desc' },
    include: { causalEstimates: true } as never,
  })
  return NextResponse.json({
    experiments: experiments.map((e) => ({
      id: e.id,
      name: e.name,
      hypothesis: e.hypothesis,
      objective: e.objective,
      primaryMetric: e.primaryMetric,
      methodology: e.methodology,
      status: e.status,
      decision: e.decision,
      learning: e.learning,
      durationDays: e.durationDays,
      sampleSize: e.sampleSize,
      startDate: e.startDate,
      endDate: e.endDate,
      causalEstimates: (e as unknown as { causalEstimates?: unknown[] }).causalEstimates ?? [],
    })),
  })
})

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  if (body.action === 'complete') {
    const out = await completeExperiment(body.experimentId, {
      decision: body.decision,
      learning: body.learning,
      effectSizePct: body.effectSizePct,
      uncertaintyLow: body.uncertaintyLow,
      uncertaintyHigh: body.uncertaintyHigh,
      confidence: body.confidence ?? 0.9,
    })
    return NextResponse.json({ ok: true, ...out })
  }
  const exp = await createExperiment({
    name: body.name,
    hypothesis: body.hypothesis,
    objective: body.objective,
    primaryMetric: body.primaryMetric,
    methodology: body.methodology,
    durationDays: body.durationDays,
    campaignId: body.campaignId,
  })
  return NextResponse.json({ ok: true, id: exp.id })
})
