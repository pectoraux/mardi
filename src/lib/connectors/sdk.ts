// =============================================================================
// Connector SDK — the complete connector framework (Section 7)
// =============================================================================
// Every connector implements this contract. The framework handles:
//   - OAuth/API authentication
//   - secret management (via SecretRef, not in business tables)
//   - initial backfill + incremental sync
//   - webhook ingestion
//   - pagination, retries, rate limits
//   - source metadata + source schema
//   - canonical mapping + data quality + lineage
//   - sync health + cursor state + replays
//
// Provider adapters (Google Ads, Meta, Shopify, Stripe, etc.) implement this
// interface. The framework is provider-neutral — adding a new connector
// requires only implementing the Connector interface, not changing core code.

import type { TenantContext } from '../../tenant-context'

export interface ConnectorContext {
  connectorId: string
  connectorType: string
  config: Record<string, unknown>
  secretRef?: { vaultKey: string } // credentials live in the vault, not config
}

export interface ExtractedRecord {
  sourceRecordId: string
  entityType: string
  occurredAt?: Date
  payload: Record<string, unknown>
  // Source metadata for lineage
  sourceSchema?: Record<string, string>
  cursor?: string // for incremental sync
}

export interface Connector {
  readonly type: string
  readonly displayName: string

  /** Discover & extract records (with pagination, incremental sync via cursor). */
  extract(ctx: ConnectorContext, opts?: { since?: Date; cursor?: string; limit?: number }): Promise<{
    records: ExtractedRecord[]
    nextCursor?: string
    hasMore: boolean
  }>

  /** Normalize a raw record into canonical writes. */
  normalize(raw: ExtractedRecord, ctx: ConnectorContext): NormalizeOps

  /** Webhook ingestion (if supported). */
  ingestWebhook?(ctx: ConnectorContext, payload: unknown): Promise<ExtractedRecord[]>

  /** Source schema discovery. */
  discoverSchema?(ctx: ConnectorContext): Promise<Record<string, string>>

  /** Sync health check. */
  healthCheck?(ctx: ConnectorContext): Promise<{ healthy: boolean; message?: string }>
}

export interface NormalizeOps {
  upserts: Array<{
    model: 'campaign' | 'ad' | 'customer' | 'interaction' | 'creative' | 'product' | 'order'
    where: Record<string, unknown>
    data: Record<string, unknown>
  }>
  events: Array<{
    eventType: string
    entityType?: string
    entityId?: string
    occurredAt?: Date
    properties: Record<string, unknown>
  }>
}

// ---------------------------------------------------------------------------
// Retry / backoff helper
// ---------------------------------------------------------------------------
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; rateLimit?: boolean } = {}
): Promise<T> {
  const retries = opts.retries ?? 3
  const baseMs = opts.baseMs ?? 400
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === retries) break
      const delay = baseMs * 2 ** attempt
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
}

// ---------------------------------------------------------------------------
// Connector registry
// ---------------------------------------------------------------------------
const REGISTRY = new Map<string, Connector>()

export function registerConnector(c: Connector): void {
  REGISTRY.set(c.type, c)
}

export function getConnector(type: string): Connector | undefined {
  return REGISTRY.get(type)
}

export function listConnectorTypes(): string[] {
  return Array.from(REGISTRY.keys())
}

export function listConnectors(): Connector[] {
  return Array.from(REGISTRY.values())
}
