import { NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'

export const GET = withTenant(async (_req, { ctx }) => {
  const [tenants, brands, campaigns, customers, experiments, causalEstimates, recommendations, decisions, events, connectors, rawRecords] =
    await Promise.all([
      Promise.resolve(ctx),
      t.brand.findMany({ include: { products: true } as never }),
      t.campaign.findMany({}),
      t.customer.findMany({ take: 10000 }),
      t.experiment.findMany({}),
      t.causalEstimate.findMany({}),
      t.recommendation.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      t.decision.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      t.event.findMany({ orderBy: { occurredAt: 'desc' }, take: 12 }),
      t.connector.findMany({}),
      t.rawRecord.findMany({ orderBy: { ingestedAt: 'desc' }, take: 8 }),
    ])

  const totalSpend = campaigns.reduce((s, c) => s + (c.spent ?? 0), 0)
  const totalRevenue = customers.reduce((s, c) => s + (c.ltv ?? 0), 0)
  const totalLift = causalEstimates.length
    ? causalEstimates.reduce((s, c) => s + c.effectSizePct, 0) / causalEstimates.length
    : 0

  // Channel breakdown
  const byChannel = new Map<string, { spend: number; campaigns: number }>()
  for (const c of campaigns) {
    const k = c.channel
    if (!byChannel.has(k)) byChannel.set(k, { spend: 0, campaigns: 0 })
    const e = byChannel.get(k)!
    e.spend += c.spent ?? 0
    e.campaigns += 1
  }

  // Customer segment breakdown
  const bySegment = new Map<string, { count: number; ltv: number }>()
  for (const c of customers) {
    const k = c.segment ?? 'unknown'
    if (!bySegment.has(k)) bySegment.set(k, { count: 0, ltv: 0 })
    const e = bySegment.get(k)!
    e.count += 1
    e.ltv += c.ltv ?? 0
  }

  return NextResponse.json({
    tenant: {
      slug: tenants.tenantSlug,
      roles: tenants.roles,
      region: tenants.region,
      autonomyLevel: tenants.autonomyLevel,
    },
    brands: brands.map((b) => ({
      id: b.id,
      name: b.name,
      category: b.category,
      productCount: (b as unknown as { products?: unknown[] }).products?.length ?? 0,
    })),
    metrics: {
      totalSpend: Math.round(totalSpend),
      totalRevenue: Math.round(totalRevenue),
      avgCausalLift: Math.round(totalLift * 1000) / 10,
      campaignCount: campaigns.length,
      customerCount: customers.length,
      experimentCount: experiments.length,
      causalEstimateCount: causalEstimates.length,
      recommendationCount: recommendations.length,
      decisionCount: decisions.length,
      eventCount: events.length,
      rawRecordCount: rawRecords.length,
      connectorCount: connectors.length,
    },
    channels: Array.from(byChannel.entries()).map(([k, v]) => ({
      channel: k,
      spend: Math.round(v.spend),
      campaigns: v.campaigns,
    })),
    segments: Array.from(bySegment.entries()).map(([k, v]) => ({
      segment: k,
      count: v.count,
      avgLtv: Math.round((v.ltv / v.count) * 10) / 10,
    })),
    recentEvents: events.map((e) => ({
      id: e.id,
      type: e.eventType,
      source: e.source,
      occurredAt: e.occurredAt,
      entityId: e.entityId,
    })),
    connectors: connectors.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      status: c.status,
      lastSyncAt: c.lastSyncAt,
      recordsPulled: c.recordsPulled,
      lastError: c.lastError,
    })),
    rawRecords: rawRecords.map((r) => ({
      id: r.id,
      source: r.source,
      entityType: r.entityType,
      sourceRecordId: r.sourceRecordId,
      dataQuality: r.dataQuality,
      ingestedAt: r.ingestedAt,
      lineageId: r.lineageId,
    })),
  })
})
