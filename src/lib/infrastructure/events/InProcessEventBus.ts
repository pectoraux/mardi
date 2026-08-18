// Bootstrap EventBus adapter — in-process + Postgres durable storage.
// Production adapter (Kafka) would be added behind the same interface.

import type { EventBusPort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'
import type { CanonicalEvent } from '../../domain/entities'
import { t } from '../../tenant-guard'
import { requireTenantId } from '../../tenant-context'
import { randomUUID } from 'node:crypto'

type Subscriber = (e: CanonicalEvent) => void | Promise<void>
const subscribers = new Map<string, Set<Subscriber>>()

export const InProcessEventBus: EventBusPort = {
  async emit(ctx, event) {
    const tenantId = requireTenantId()
    const occurredAt = event.occurredAt ?? new Date()
    const eventId = `${tenantId}:${event.source}:${randomUUID()}`

    await t.event.create({
      data: {
        eventId,
        tenantId,
        eventType: event.eventType,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        source: event.source,
        occurredAt,
        schemaVersion: 1,
        payload: JSON.stringify(event.properties),
        lineageId: event.lineageId ?? null,
      } as never,
    })

    const canonical: CanonicalEvent = {
      id: '',
      eventId,
      tenantId,
      eventType: event.eventType,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      source: event.source,
      occurredAt,
      ingestedAt: new Date(),
      schemaVersion: 1,
      payload: JSON.stringify(event.properties),
      lineageId: event.lineageId ?? null,
    }

    // Dispatch to in-process subscribers
    const matches = new Set<Subscriber>([
      ...(subscribers.get('*') ?? []),
      ...(subscribers.get(event.eventType) ?? []),
    ])
    for (const fn of matches) {
      try { await fn(canonical) } catch (err) { console.error('[event-bus] subscriber error', err) }
    }
    return canonical
  },

  subscribe(eventType, fn) {
    let set = subscribers.get(eventType)
    if (!set) { set = new Set(); subscribers.set(eventType, set) }
    set.add(fn)
    return () => set!.delete(fn)
  },

  async *replay(ctx, opts) {
    const where: Record<string, unknown> = {}
    if (opts?.eventType) where.eventType = opts.eventType
    if (opts?.since) where.occurredAt = { gt: opts.since }
    const limit = opts?.limit ?? 5000
    const rows = await t.event.findMany({ where, orderBy: { occurredAt: 'asc' }, take: limit })
    for (const r of rows) {
      yield {
        id: r.id,
        eventId: r.eventId,
        tenantId: r.tenantId,
        eventType: r.eventType,
        entityType: r.entityType ?? null,
        entityId: r.entityId ?? null,
        source: r.source,
        occurredAt: r.occurredAt,
        ingestedAt: r.ingestedAt,
        schemaVersion: r.schemaVersion,
        payload: r.payload,
        lineageId: r.lineageId ?? null,
      }
    }
  },
}
