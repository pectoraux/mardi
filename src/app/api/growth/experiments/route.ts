import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'

export const GET = withTenant(async (_req, _ctx) => {
  const experiments = await t.growthExperiment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { prospects: true, outreaches: true } as never,
  })
  return NextResponse.json({
    experiments: experiments.map((e) => ({
      id: e.id,
      name: e.name,
      hypothesis: e.hypothesis,
      icp: e.icp ? JSON.parse(e.icp) : null,
      problem: e.problem,
      acquisitionMechanism: e.acquisitionMechanism,
      distributionChannel: e.distributionChannel,
      cost: e.cost,
      effortHours: e.effortHours,
      status: e.status,
      funnel: {
        exposure: e.exposure,
        visitors: e.visitors,
        leads: e.leads,
        qualifiedLeads: e.qualifiedLeads,
        signups: e.signups,
        activatedUsers: e.activatedUsers,
        customers: e.customers,
        revenue: e.revenue,
        contributionMargin: e.contributionMargin,
        timeToConversionDays: e.timeToConversionDays,
      },
      decision: e.decision,
      learning: e.learning,
      startDate: e.startDate,
      endDate: e.endDate,
      prospectCount: (e as unknown as { prospects?: unknown[] }).prospects?.length ?? 0,
      outreachCount: (e as unknown as { outreaches?: unknown[] }).outreaches?.length ?? 0,
    })),
  })
})

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const exp = await t.growthExperiment.create({
    data: {
      name: body.name,
      hypothesis: body.hypothesis,
      icp: body.icp ? JSON.stringify(body.icp) : null,
      problem: body.problem ?? null,
      acquisitionMechanism: body.acquisitionMechanism,
      distributionChannel: body.distributionChannel ?? null,
      cost: body.cost ?? 0,
      effortHours: body.effortHours ?? 0,
      expectedOutcome: body.expectedOutcome ? JSON.stringify(body.expectedOutcome) : null,
      status: 'running',
      startDate: new Date(),
    },
  })
  return NextResponse.json({ ok: true, id: exp.id })
})
