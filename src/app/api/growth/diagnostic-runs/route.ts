import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { getTenantContext } from '@/lib/tenant-context'

// GET — list diagnostic runs with their funnel stage
export const GET = withTenant(async (req: NextRequest, _ctx) => {
  const stage = req.nextUrl.searchParams.get('stage') ?? undefined
  const runs = await t.diagnosticRun.findMany({
    where: stage ? { stage } : {},
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      company: r.company,
      website: r.website,
      industry: r.industry,
      size: r.size,
      stage: r.stage,
      prospectId: r.prospectId,
      provider: r.provider,
      model: r.model,
      fellBack: r.fellBack,
      createdAt: r.createdAt,
      promotedAt: r.promotedAt,
      diagnosis: JSON.parse(r.diagnosis),
    })),
  })
})

// POST — promote a diagnostic run to a Prospect (explicit operator action)
export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const { action, diagnosticRunId } = (body ?? {}) as {
    action: 'promote_to_prospect' | 'reject'
    diagnosticRunId: string
  }
  if (!action || !diagnosticRunId) {
    return NextResponse.json({ error: 'action and diagnosticRunId required' }, { status: 400 })
  }

  const ctx = getTenantContext()
  const run = await t.diagnosticRun.findUnique({ where: { id: diagnosticRunId } })
  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 })

  if (action === 'reject') {
    const updated = await t.diagnosticRun.update({
      where: { id: diagnosticRunId },
      data: { stage: 'rejected', promotedAt: new Date(), promotedBy: ctx.userId ?? 'operator' },
    })
    return NextResponse.json({ ok: true, stage: updated.stage })
  }

  // Promote to Prospect
  const diagnosis = JSON.parse(run.diagnosis) as {
    recommendedAngle?: string
    suggestedCTA?: string
    mardiFit?: string
    opportunities?: Array<{ title: string; confidence: number }>
  }

  // Find or create a growth experiment for promoted prospects
  let exp = await t.growthExperiment.findFirst({
    where: { acquisitionMechanism: 'founder_outreach' },
  })
  if (!exp) {
    exp = await t.growthExperiment.create({
      data: {
        name: 'Founder-led outreach to qualified prospects',
        hypothesis: 'Personalized, evidence-backed outreach to qualified prospects will generate a higher qualified-response rate than generic outreach.',
        acquisitionMechanism: 'founder_outreach',
        distributionChannel: 'email',
        cost: 0,
        effortHours: 0,
        status: 'running',
        startDate: new Date(),
      },
    })
  }

  const prospect = await t.prospect.create({
    data: {
      company: run.company,
      website: run.website,
      industry: run.industry,
      size: run.size,
      icpFitScore: 0.6, // initial — refined by operator review
      qualificationSignals: JSON.stringify(diagnosis.opportunities?.map((o) => o.title) ?? []),
      opportunitySignals: JSON.stringify({
        recommendedAngle: diagnosis.recommendedAngle,
        suggestedCTA: diagnosis.suggestedCTA,
        mardiFit: diagnosis.mardiFit,
      }),
      status: 'identified',
      outreachState: 'none',
      source: 'diagnostic_tool',
      growthExperimentId: exp.id,
      notes: `Promoted from diagnostic run ${run.id}`,
    },
  })

  await t.diagnosticRun.update({
    where: { id: diagnosticRunId },
    data: {
      stage: 'promoted_to_prospect',
      prospectId: prospect.id,
      promotedAt: new Date(),
      promotedBy: ctx.userId ?? 'operator',
    },
  })

  // Increment experiment exposure (a qualified prospect is an exposure)
  await t.growthExperiment.update({
    where: { id: exp.id },
    data: { exposure: { increment: 1 } },
  })

  return NextResponse.json({ ok: true, prospectId: prospect.id, stage: 'promoted_to_prospect' })
})
