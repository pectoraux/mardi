// =============================================================================
// Mock Shopify connector (Section 9)
// =============================================================================
// Mocks extraction of customer + order (purchase) records from Shopify.

import type { Connector, ConnectorContext, ExtractedRecord, NormalizeOps } from './framework'
import { registerConnector } from './framework'
import { t } from '../tenant-guard'

export const shopifyConnector: Connector = {
  type: 'shopify',

  async extract(_ctx: ConnectorContext, opts?: { since?: Date }): Promise<ExtractedRecord[]> {
    const since = opts?.since ?? new Date(Date.now() - 7 * 86400_000)
    const customers = await t.customer.findMany({ take: 200 })
    const records: ExtractedRecord[] = []

    for (const c of customers) {
      // A new order for ~30% of customers, only those active since `since`
      if (Math.random() < 0.3) {
        const orderId = `#${Math.floor(100000 + Math.random() * 900000)}`
        const total = Math.round((20 + Math.random() * 90) * 100) / 100
        records.push({
          sourceRecordId: `shopify:order:${orderId}`,
          entityType: 'order',
          occurredAt: new Date(),
          payload: {
            order_id: orderId,
            customer_id: c.externalId,
            customer_email: c.email,
            total_price: total,
            currency: 'USD',
            line_items: 1 + Math.floor(Math.random() * 3),
            source: 'shopify',
          },
        })
      }
    }
    void since
    return records
  },

  normalize(raw: ExtractedRecord, _ctx: ConnectorContext): NormalizeOps {
    if (raw.entityType === 'order') {
      const p = raw.payload as {
        order_id: string
        customer_id?: string
        customer_email?: string
        total_price: number
        currency: string
        line_items: number
      }
      return {
        upserts: [
          {
            model: 'customer',
            where: { externalId: p.customer_id ?? 'unknown' },
            data: {
              email: p.customer_email ?? null,
              ltv: p.total_price,
            },
          },
          {
            model: 'interaction',
            where: {},
            data: {
              type: 'purchase',
              value: p.total_price,
              occurredAt: raw.occurredAt ?? new Date(),
              source: 'shopify',
            },
          },
        ],
        events: [
          {
            eventType: 'purchase_created',
            entityType: 'Customer',
            entityId: p.customer_id,
            occurredAt: raw.occurredAt,
            properties: p,
          },
        ],
      }
    }
    return { upserts: [], events: [] }
  },
}

registerConnector(shopifyConnector)
