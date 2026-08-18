// =============================================================================
// Connector SDK — Section 9
// =============================================================================
// Every connector implements this contract. The framework handles:
//   - authentication (mocked via env / config)
//   - extraction (with pagination)
//   - rate limiting (simple token bucket)
//   - retries (exponential backoff)
//   - raw record retention (RAW -> ADAPTER -> CANONICAL -> QUALITY -> TRUSTED)
//   - normalization to canonical model
//   - lineage tracking (lineage_id propagated end-to-end)
//   - event emission
//   - health status + error reporting

import { t } from '../tenant-guard'
import { emit } from '../event-bus'
import { randomUUID } from 'node:crypto'

export interface ConnectorContext {
  connectorId: string
  connectorType: string
  config: Record<string, unknown>
}

export interface ExtractedRecord {
  sourceRecordId: string
  entityType: string
  occurredAt?: Date
  payload: Record<string, unknown>
}

export interface Connector {
  type: string
  /** Discover & extract records (mocked for MVP — real impls hit the API). */
  extract(ctx: ConnectorContext, opts?: { since?: Date }): Promise<ExtractedRecord[]>
  /** Normalize a raw record into canonical writes (returns ops to apply). */
  normalize(raw: ExtractedRecord, ctx: ConnectorContext): NormalizeOps
}

export interface NormalizeOps {
  upserts: Array<{
    model: 'campaign' | 'ad' | 'customer' | 'interaction' | 'creative'
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
  opts: { retries?: number; baseMs?: number } = {}
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
// Sync orchestration — runs extract -> persist raw -> normalize -> emit events
// ---------------------------------------------------------------------------
export async function runConnectorSync(
  connectorId: string,
  connector: Connector,
  opts?: { since?: Date }
): Promise<{ recordsPulled: number; eventsEmitted: number }> {
  const conn = await t.connector.findUnique({ where: { id: connectorId } })
  if (!conn) throw new Error(`connector not found: ${connectorId}`)

  await t.connector.update({
    where: { id: connectorId },
    data: { status: 'syncing', lastError: null },
  })

  try {
    const ctx: ConnectorContext = {
      connectorId,
      connectorType: conn.type,
      config: JSON.parse(conn.config || '{}'),
    }

    const records = await withRetry(() => connector.extract(ctx, opts))
    let eventsEmitted = 0

    for (const rec of records) {
      // 1. Persist RAW (idempotent on (connectorId, sourceRecordId))
      const lineageId = randomUUID()
      const existing = await t.rawRecord.findUnique({
        where: { connectorId_sourceRecordId: { connectorId, sourceRecordId: rec.sourceRecordId } },
      })
      if (existing) continue // idempotent: skip already-ingested

      const raw = await t.rawRecord.create({
        data: {
          connectorId,
          source: conn.type,
          sourceRecordId: rec.sourceRecordId,
          entityType: rec.entityType,
          payload: JSON.stringify(rec.payload),
          schemaVersion: 1,
          dataQuality: 'valid',
          occurredAt: rec.occurredAt ?? null,
          lineageId,
        },
      })

      // 2. Normalize to canonical ops
      const ops = connector.normalize(rec, ctx)

      // 3. Apply canonical upserts
      for (const up of ops.upserts) {
        await applyUpsert(up, lineageId)
      }

      // 4. Emit events (carries lineage_id end-to-end)
      for (const ev of ops.events) {
        await emit(ev.eventType, {
          source: conn.type,
          entityType: ev.entityType,
          entityId: ev.entityId,
          occurredAt: ev.occurredAt,
          properties: ev.properties,
          lineageId,
        })
        eventsEmitted++
      }
      void raw
    }

    await t.connector.update({
      where: { id: connectorId },
      data: {
        status: 'connected',
        lastSyncAt: new Date(),
        lastSyncStatus: 'ok',
        recordsPulled: conn.recordsPulled + records.length,
      },
    })
    return { recordsPulled: records.length, eventsEmitted }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await t.connector.update({
      where: { id: connectorId },
      data: { status: 'error', lastSyncAt: new Date(), lastSyncStatus: 'failed', lastError: message },
    })
    throw err
  }
}

async function applyUpsert(
  up: NormalizeOps['upserts'][number],
  lineageId: string
): Promise<void> {
  // Only `interaction` carries a lineageId column in the schema; for other
  // models the lineage is tracked via the RawRecord + the emitted Event
  // (both reference the same lineageId). This keeps the canonical model
  // clean while preserving end-to-end lineage (Section 10).
  const data =
    up.model === 'interaction' ? { ...up.data, lineageId } : { ...up.data }
  switch (up.model) {
    case 'campaign': {
      const existing = await t.campaign.findFirst({ where: up.where })
      if (existing) await t.campaign.update({ where: { id: existing.id }, data })
      else await t.campaign.create({ data: { ...data, ...up.where } as never })
      break
    }
    case 'customer': {
      const existing = await t.customer.findFirst({ where: up.where })
      if (existing) await t.customer.update({ where: { id: existing.id }, data })
      else await t.customer.create({ data: { ...data, ...up.where } as never })
      break
    }
    case 'interaction': {
      await t.interaction.create({ data: { ...data, ...up.where } as never })
      break
    }
    case 'ad': {
      const existing = await t.ad.findFirst({ where: up.where })
      if (existing) await t.ad.update({ where: { id: existing.id }, data })
      else await t.ad.create({ data: { ...data, ...up.where } as never })
      break
    }
    case 'creative': {
      const existing = await t.creative.findFirst({ where: up.where })
      if (existing) await t.creative.update({ where: { id: existing.id }, data })
      else await t.creative.create({ data: { ...data, ...up.where } as never })
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Registry
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
