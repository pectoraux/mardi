import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'

export const GET = withTenant(async (_req, _ctx) => {
  const prospects = await t.prospect.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { outreaches: true } as never,
  })
  return NextResponse.json({
    prospects: prospects.map((p) => ({
      id: p.id,
      company: p.company,
      website: p.website,
      industry: p.industry,
      size: p.size,
      region: p.region,
      contactName: p.contactName,
      contactEmail: p.contactEmail,
      contactTitle: p.contactTitle,
      linkedinUrl: p.linkedinUrl,
      icpFitScore: p.icpFitScore,
      qualificationSignals: p.qualificationSignals ? JSON.parse(p.qualificationSignals) : [],
      opportunitySignals: p.opportunitySignals ? JSON.parse(p.opportunitySignals) : [],
      status: p.status,
      outreachState: p.outreachState,
      lastContactedAt: p.lastContactedAt,
      source: p.source,
      notes: p.notes,
      growthExperimentId: p.growthExperimentId,
      outreachCount: (p as unknown as { outreaches?: unknown[] }).outreaches?.length ?? 0,
      createdAt: p.createdAt,
    })),
  })
})

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const p = await t.prospect.create({
    data: {
      company: body.company,
      website: body.website ?? null,
      industry: body.industry ?? null,
      size: body.size ?? null,
      region: body.region ?? null,
      contactName: body.contactName ?? null,
      contactEmail: body.contactEmail ?? null,
      contactTitle: body.contactTitle ?? null,
      linkedinUrl: body.linkedinUrl ?? null,
      icpFitScore: body.icpFitScore ?? 0,
      qualificationSignals: body.qualificationSignals ? JSON.stringify(body.qualificationSignals) : null,
      opportunitySignals: body.opportunitySignals ? JSON.stringify(body.opportunitySignals) : null,
      source: body.source ?? 'manual',
      growthExperimentId: body.growthExperimentId ?? null,
      notes: body.notes ?? null,
    },
  })
  return NextResponse.json({ ok: true, id: p.id })
})
