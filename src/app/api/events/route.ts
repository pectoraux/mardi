import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'

export const GET = withTenant(async (req: NextRequest, _ctx) => {
  const eventType = req.nextUrl.searchParams.get('type') ?? undefined
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 100), 500)
  const events = await t.event.findMany({
    where: eventType ? { eventType } : {},
    orderBy: { occurredAt: 'desc' },
    take: limit,
  })
  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      eventId: e.eventId,
      type: e.eventType,
      source: e.source,
      entityType: e.entityType,
      entityId: e.entityId,
      occurredAt: e.occurredAt,
      ingestedAt: e.ingestedAt,
      schemaVersion: e.schemaVersion,
      lineageId: e.lineageId,
      properties: JSON.parse(e.payload),
    })),
  })
})
