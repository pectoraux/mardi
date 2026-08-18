// =============================================================================
// Mock Google Ads connector (Section 9)
// =============================================================================
// Mocks extraction of campaign + interaction records from Google Ads. In
// production this would hit the Google Ads API with OAuth2 + pagination;
// here we synthesize deterministic-but-realistic records per tenant so the
// full RAW -> CANONICAL -> EVENT pipeline is exercised.

import type { Connector, ConnectorContext, ExtractedRecord, NormalizeOps } from './framework'
import { registerConnector } from './framework'
import { t } from '../tenant-guard'

export const googleAdsConnector: Connector = {
  type: 'google_ads',

  async extract(ctx: ConnectorContext, opts?: { since?: Date }): Promise<ExtractedRecord[]> {
    // Use existing tenant campaigns as the source of truth for what to "fetch".
    const campaigns = await t.campaign.findMany({
      where: { channel: 'google_ads' },
      take: 50,
    })
    const records: ExtractedRecord[] = []
    const since = opts?.since ?? new Date(Date.now() - 7 * 86400_000)

    for (const c of campaigns) {
      // 1. Campaign performance snapshot (raw)
      records.push({
        sourceRecordId: `gads:campaign:${c.externalId ?? c.id}:snapshot`,
        entityType: 'campaign_performance',
        occurredAt: new Date(),
        payload: {
          campaign_id: c.externalId ?? c.id,
          campaign_name: c.name,
          spend_today: Math.round((c.budget ?? 0) * 0.02 * 100) / 100,
          impressions: 12000 + Math.floor(Math.random() * 8000),
          clicks: 320 + Math.floor(Math.random() * 180),
          conversions: 18 + Math.floor(Math.random() * 14),
          revenue: Math.round((c.budget ?? 0) * 0.05 * 100) / 100,
          currency: 'USD',
          date: new Date().toISOString().slice(0, 10),
        },
      })

      // 2. A few interaction-level records (clicks)
      for (let i = 0; i < 5; i++) {
        records.push({
          sourceRecordId: `gads:click:${c.externalId ?? c.id}:${Date.now()}:${i}`,
          entityType: 'click',
          occurredAt: new Date(Date.now() - i * 3_600_000),
          payload: {
            campaign_id: c.externalId ?? c.id,
            gclid: `Cj${Math.random().toString(36).slice(2, 12)}`,
            device: ['mobile', 'desktop', 'tablet'][i % 3],
            geo: ['US-CA', 'US-NY', 'US-TX'][i % 3],
            keyword: ctx.config.keyword ?? 'coffee|skincare',
          },
        })
      }
      void since
    }
    return records
  },

  normalize(raw: ExtractedRecord, _ctx: ConnectorContext): NormalizeOps {
    if (raw.entityType === 'campaign_performance') {
      const p = raw.payload as {
        campaign_id: string
        campaign_name: string
        spend_today: number
        impressions: number
        clicks: number
        conversions: number
        revenue: number
        date: string
      }
      return {
        upserts: [
          {
            model: 'campaign',
            where: { externalId: p.campaign_id },
            data: {
              name: p.campaign_name,
              channel: 'google_ads',
              status: 'active',
              spent: p.spend_today,
            },
          },
        ],
        events: [
          {
            eventType: 'campaign_performance_snapshot',
            entityType: 'Campaign',
            entityId: p.campaign_id,
            occurredAt: raw.occurredAt,
            properties: p,
          },
        ],
      }
    }
    if (raw.entityType === 'click') {
      const p = raw.payload as { campaign_id: string; gclid: string; device: string; geo: string }
      return {
        upserts: [
          {
            model: 'interaction',
            where: {},
            data: {
              type: 'click',
              value: 0,
              occurredAt: raw.occurredAt ?? new Date(),
              source: 'google_ads',
            },
          },
        ],
        events: [
          {
            eventType: 'click_created',
            entityType: 'Campaign',
            entityId: p.campaign_id,
            occurredAt: raw.occurredAt,
            properties: p,
          },
        ],
      }
    }
    return { upserts: [], events: [] }
  },
}

registerConnector(googleAdsConnector)
