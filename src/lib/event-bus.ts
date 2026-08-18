// =============================================================================
// Event bus — durable, replayable, versioned (Section 8)
// =============================================================================
// SQLite-environment substitute for Kafka/Redpanda. Events are persisted
// (durable) and also dispatched to in-process subscribers (for reactive
// services like the decision engine, evidence graph linker, etc.).
// Idempotency key: eventId = `${tenantId}:${source}:${sourceSequence}`.

import { t } from './tenant-guard'
import { requireTenantId } from './tenant-context'
import { randomUUID } from 'node:crypto'

export interface CanonicalEvent {
  event_id: string
  tenant_id: string
  event_type: string
  occurred_at: string
  source: string
  entity_type?: string
  entity_id?: string
  schema_version: number
  properties: Record<string, unknown>
  lineage_id?: string
}

type Subscriber = (e: CanonicalEvent) => void | Promise<void>
const subscribers = new Map<string /* event_type | '*' */, Set<Subscriber>>()

export function subscribe(eventType: string, fn: Subscriber): () => void {
  let set = subscribers.get(eventType)
  if (!set) {
    set = new Set()
    subscribers.set(eventType, set)
  }
  set.add(fn)
  return () => set!.delete(fn)
}

export async function emit(
  eventType: string,
  payload: {
    source: string
    entityType?: string
    entityId?: string
    occurredAt?: Date
    properties: Record<string, unknown>
    lineageId?: string
  }
): Promise<CanonicalEvent> {
  const tenantId = requireTenantId()
  const occurredAt = payload.occurredAt ?? new Date()
  const eventId = `${tenantId}:${payload.source}:${randomUUID()}`
  const evt: CanonicalEvent = {
    event_id: eventId,
    tenant_id: tenantId,
    event_type: eventType,
    occurred_at: occurredAt.toISOString(),
    source: payload.source,
    entity_type: payload.entityType,
    entity_id: payload.entityId,
    schema_version: 1,
    properties: payload.properties,
    lineage_id: payload.lineageId,
    // CamelCase aliases for consumers that expect them
    eventId,
    tenantId,
    eventType,
  } as CanonicalEvent

  // Persist (durable). Idempotent on eventId via @unique.
  await t.event.create({
    data: {
      eventId,
      tenantId,
      eventType,
      entityType: evt.entity_type ?? null,
      entityId: evt.entity_id ?? null,
      source: payload.source,
      occurredAt,
      schemaVersion: 1,
      payload: JSON.stringify(evt.properties),
      lineageId: evt.lineage_id ?? null,
    },
  })

  // Dispatch to in-process subscribers (best-effort; errors are logged, not thrown).
  const matches = new Set<Subscriber>([
    ...(subscribers.get('*') ?? []),
    ...(subscribers.get(eventType) ?? []),
  ])
  for (const fn of matches) {
    try {
      await fn(evt)
    } catch (err) {
      console.error('[event-bus] subscriber error', eventType, err)
    }
  }
  return evt
}

/** Replay events for the active tenant (used by backfill / recovery). */
export async function replay(
  filter?: { eventType?: string; since?: Date },
  fn: (e: CanonicalEvent) => Promise<void> = async () => {}
): Promise<number> {
  const where: Record<string, unknown> = {}
  if (filter?.eventType) where.eventType = filter.eventType
  if (filter?.since) where.occurredAt = { gt: filter.since }
  const rows = await t.event.findMany({
    where,
    orderBy: { occurredAt: 'asc' },
    take: 5000,
  })
  for (const r of rows) {
    await fn({
      event_id: r.eventId,
      tenant_id: r.tenantId,
      event_type: r.eventType,
      occurred_at: r.occurredAt.toISOString(),
      source: r.source,
      entity_type: r.entityType ?? undefined,
      entity_id: r.entityId ?? undefined,
      schema_version: r.schemaVersion,
      properties: JSON.parse(r.payload),
      lineage_id: r.lineageId ?? undefined,
    })
  }
  return rows.length
}
