'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Database, Loader2, Plug, RefreshCw, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { type DashboardData, type EventRow, apiFetch, fmtDateTime } from './types'

interface Props {
  tenant: string
  dash: DashboardData
}

export function DataTab({ tenant, dash }: Props) {
  const qc = useQueryClient()
  const eventsQ = useQuery({
    queryKey: ['events', tenant],
    queryFn: () => apiFetch<{ events: EventRow[] }>('/api/events?limit=50', tenant),
  })

  async function syncConnector(connectorId: string, name: string) {
    const t = toast.loading(`Syncing ${name}…`)
    try {
      const r = await apiFetch<{ ok: boolean; recordsPulled: number; eventsEmitted: number }>(
        '/api/connectors',
        tenant,
        { method: 'POST', body: { action: 'sync', connectorId } }
      )
      toast.success(`${name}: ${r.recordsPulled} raw records → ${r.eventsEmitted} events`, { id: t })
      qc.invalidateQueries({ queryKey: ['dashboard', tenant] })
      qc.invalidateQueries({ queryKey: ['events', tenant] })
    } catch (e) {
      toast.error(`Sync failed: ${String(e).slice(0, 120)}`, { id: t })
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plug className="size-4 text-amber-600" /> Connectors
          </CardTitle>
          <CardDescription>
            Section 9 — Connector framework: auth, extraction, pagination, retries, raw retention, normalization, lineage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {dash.connectors.map((c) => {
              const statusIcon =
                c.status === 'syncing' ? <Loader2 className="size-4 animate-spin text-amber-600" /> :
                c.status === 'error' ? <XCircle className="size-4 text-destructive" /> :
                <CheckCircle2 className="size-4 text-emerald-600" />
              return (
                <div key={c.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {statusIcon}
                        {c.name}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                        {c.type.replace('_', ' ')} · {c.recordsPulled} records pulled
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5"
                      onClick={() => syncConnector(c.id, c.name)}
                      disabled={c.status === 'syncing'}
                    >
                      <RefreshCw className="size-3" />
                      Sync
                    </Button>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Last sync: {c.lastSyncAt ? fmtDateTime(c.lastSyncAt) : 'never'}
                  </div>
                  {c.lastError && (
                    <div className="text-[11px] text-destructive bg-destructive/5 rounded p-1.5 font-mono break-all">
                      {c.lastError.slice(0, 200)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="size-4 text-fuchsia-600" /> Raw Records Retained
          </CardTitle>
          <CardDescription>
            Verbatim source records preserved (Section 10). Lineage id propagates through normalization → events → evidence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dash.rawRecords.length === 0 ? (
            <div className="text-xs text-muted-foreground italic py-3 text-center">
              No raw records yet. Click <span className="font-medium">Sync</span> on a connector above.
            </div>
          ) : (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-1.5 pr-3 font-medium">Source</th>
                    <th className="py-1.5 pr-3 font-medium">Entity</th>
                    <th className="py-1.5 pr-3 font-medium">Record ID</th>
                    <th className="py-1.5 pr-3 font-medium">Quality</th>
                    <th className="py-1.5 pr-3 font-medium">Ingested</th>
                    <th className="py-1.5 font-medium">Lineage</th>
                  </tr>
                </thead>
                <tbody>
                  {dash.rawRecords.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-3 font-medium">{r.source}</td>
                      <td className="py-1.5 pr-3">{r.entityType}</td>
                      <td className="py-1.5 pr-3 font-mono text-[11px]">{r.sourceRecordId.slice(0, 32)}…</td>
                      <td className="py-1.5 pr-3">
                        <Badge variant="outline" className="text-[10px] h-5">{r.dataQuality}</Badge>
                      </td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{fmtDateTime(r.ingestedAt)}</td>
                      <td className="py-1.5 font-mono text-[10px] text-muted-foreground">{r.lineageId.slice(-8)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <RefreshCw className="size-4 text-emerald-600" /> Event Stream
          </CardTitle>
          <CardDescription>Durable, replayable, versioned events (Section 8)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-96 overflow-y-auto space-y-1.5 pr-1">
            {eventsQ.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
            {eventsQ.data?.events.length === 0 && <div className="text-xs text-muted-foreground italic">No events</div>}
            {eventsQ.data?.events.map((e) => (
              <div key={e.id} className="text-xs border-l-2 border-emerald-500/40 pl-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{e.type}</span>
                  <span className="text-muted-foreground text-[10px]">{fmtDateTime(e.occurredAt)}</span>
                </div>
                <div className="text-muted-foreground text-[11px]">
                  {e.source} · {e.entityType ?? '—'} · {e.entityId ? e.entityId.slice(-8) : '—'}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
