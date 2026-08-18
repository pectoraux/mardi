// =============================================================================
// Connector provider stubs — real abstractions, not yet API-connected.
// =============================================================================
// Section 7 specifies 15+ connector providers. Each has a real abstraction
// here. The Google Ads and Shopify connectors have working extract+normalize
// implementations. The rest are stubs that throw "not yet implemented" —
// they exist so the registry is complete and adding a real adapter is
// mechanical (implement extract + normalize, no core code changes).
//
// Per Section 52: "Do not claim a provider is live until its real API
// adapter exists." These stubs are clearly marked as NOT live.

import type { Connector, ConnectorContext, ExtractedRecord, NormalizeOps } from './sdk'
import { registerConnector } from './sdk'

// Helper for stub connectors
function stubConnector(type: string, displayName: string): Connector {
  return {
    type,
    displayName,
    async extract(_ctx: ConnectorContext, _opts): Promise<{ records: ExtractedRecord[]; hasMore: boolean }> {
      throw new Error(`${displayName} connector not yet implemented — real API adapter required (Section 52)`)
    },
    normalize(_raw: ExtractedRecord, _ctx: ConnectorContext): NormalizeOps {
      return { upserts: [], events: [] }
    },
  }
}

// --- Meta Ads ---
registerConnector(stubConnector('meta_ads', 'Meta Ads'))

// --- TikTok Ads ---
registerConnector(stubConnector('tiktok_ads', 'TikTok Ads'))

// --- LinkedIn Ads ---
registerConnector(stubConnector('linkedin_ads', 'LinkedIn Ads'))

// --- Amazon Ads ---
registerConnector(stubConnector('amazon_ads', 'Amazon Ads'))

// --- Google Analytics 4 ---
registerConnector(stubConnector('ga4', 'Google Analytics 4'))

// --- Salesforce ---
registerConnector(stubConnector('salesforce', 'Salesforce'))

// --- HubSpot ---
registerConnector(stubConnector('hubspot', 'HubSpot'))

// --- Stripe (payments + customers) ---
registerConnector(stubConnector('stripe', 'Stripe'))

// --- Segment (CDP) ---
registerConnector(stubConnector('segment', 'Segment'))

// --- Braze ---
registerConnector(stubConnector('braze', 'Braze'))

// --- Klaviyo ---
registerConnector(stubConnector('klaviyo', 'Klaviyo'))

// --- Snowflake ---
registerConnector(stubConnector('snowflake', 'Snowflake'))

// --- Databricks ---
registerConnector(stubConnector('databricks', 'Databricks'))

// Re-register the live connectors (google_ads + shopify already registered)
import './google-ads'
import './shopify'

export { listConnectorTypes, listConnectors, getConnector } from './sdk'
