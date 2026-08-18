import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { detectOpportunities, recordRecommendation } from '@/lib/intelligence/decision-engine'

export const GET = withTenant(async (_req, _ctx) => {
  const [recommendations, opportunities] = await Promise.all([
    t.recommendation.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    detectOpportunities(),
  ])
  return NextResponse.json({
    recommendations: recommendations.map((r) => ({
      id: r.id,
      opportunity: r.opportunity,
      recommendation: r.recommendation,
      expectedIncrementalProfit: r.expectedIncrementalProfit,
      expectedIncrementalRevenue: r.expectedIncrementalRevenue,
      confidence: r.confidence,
      uncertainty: r.uncertainty ? JSON.parse(r.uncertainty) : null,
      risks: r.risks ? JSON.parse(r.risks) : [],
      constraints: r.constraints ? JSON.parse(r.constraints) : [],
      nextBestExperiment: r.nextBestExperiment,
      status: r.status,
      generatedBy: r.generatedBy,
      createdAt: r.createdAt,
    })),
    opportunities,
  })
})

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  if (body.action === 'detect') {
    const opps = await detectOpportunities({ minConfidence: body.minConfidence })
    return NextResponse.json({ opportunities: opps })
  }
  if (body.action === 'create') {
    // Persist a specific opportunity as a recommendation
    const opp = body.opportunity
    if (!opp) return NextResponse.json({ error: 'opportunity required' }, { status: 400 })
    const out = await recordRecommendation(opp)
    return NextResponse.json({ ok: true, ...out })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
})
