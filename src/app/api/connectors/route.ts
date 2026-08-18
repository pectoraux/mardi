import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { getConnector, listConnectorTypes, runConnectorSync } from '@/lib/connectors'

export const GET = withTenant(async (_req, _ctx) => {
  const connectors = await t.connector.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({
    connectors: connectors.map((c) => ({
      id: c.id,
      type: c.type,
      name: c.name,
      status: c.status,
      lastSyncAt: c.lastSyncAt,
      lastSyncStatus: c.lastSyncStatus,
      lastError: c.lastError,
      recordsPulled: c.recordsPulled,
      config: JSON.parse(c.config || '{}'),
    })),
    availableTypes: listConnectorTypes(),
  })
})

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const { connectorId, type, action } = (body ?? {}) as {
    connectorId?: string
    type?: string
    action?: 'sync'
  }
  if (action !== 'sync') {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
  let connectorIdResolved = connectorId
  if (!connectorIdResolved && type) {
    const c = await t.connector.findFirst({ where: { type } })
    connectorIdResolved = c?.id
  }
  if (!connectorIdResolved) {
    return NextResponse.json({ error: 'connectorId or type required' }, { status: 400 })
  }
  const conn = await t.connector.findUnique({ where: { id: connectorIdResolved } })
  if (!conn) return NextResponse.json({ error: 'connector not found' }, { status: 404 })
  const impl = getConnector(conn.type)
  if (!impl) return NextResponse.json({ error: `no impl for type ${conn.type}` }, { status: 400 })

  const result = await runConnectorSync(connectorIdResolved, impl, { since: conn.lastSyncAt ?? undefined })
  return NextResponse.json({ ok: true, ...result })
})
