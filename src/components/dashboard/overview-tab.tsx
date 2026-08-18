'use client'

import { useQuery } from '@tanstack/react-query'
import {
  Activity, ArrowUpRight, Database, DollarSign, FlaskConical,
  Lightbulb, Network, ScrollText, Shield, Users,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  type AutonomyT, type DashboardData, apiFetch, fmtMoney, fmtPct, fmtDateTime,
} from './types'

interface Props {
  tenant: string
  dash: DashboardData
  autonomy: AutonomyT | undefined
  onSetAutonomy: (level: number) => void
}

export function OverviewTab({ tenant, dash, autonomy, onSetAutonomy }: Props) {
  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi icon={DollarSign} label="Total Spend" value={fmtMoney(dash.metrics.totalSpend)} accent="text-amber-600" />
        <Kpi icon={Users} label="Customers" value={String(dash.metrics.customerCount)} accent="text-teal-600" />
        <Kpi icon={FlaskConical} label="Experiments" value={String(dash.metrics.experimentCount)} accent="text-emerald-600" />
        <Kpi icon={Network} label="Causal Estimates" value={String(dash.metrics.causalEstimateCount)} accent="text-rose-600" />
        <Kpi icon={Lightbulb} label="Recommendations" value={String(dash.metrics.recommendationCount)} accent="text-orange-600" />
        <Kpi icon={ScrollText} label="Decisions" value={String(dash.metrics.decisionCount)} accent="text-fuchsia-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Channel breakdown */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <DollarSign className="size-4 text-amber-600" /> Channel Spend & Allocation
            </CardTitle>
            <CardDescription>Where marketing capital is deployed (current tenant)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {dash.channels.length === 0 && <Empty label="No campaigns yet" />}
            {dash.channels.map((c) => {
              const pct = dash.metrics.totalSpend > 0 ? (c.spend / dash.metrics.totalSpend) * 100 : 0
              return (
                <div key={c.channel}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium capitalize">{c.channel.replace('_', ' ')}</span>
                    <span className="text-muted-foreground">
                      {fmtMoney(c.spend)} · {c.campaigns} campaign{c.campaigns !== 1 ? 's' : ''} · {pct.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Tenant + autonomy card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="size-4 text-emerald-600" /> Tenant & Autonomy
            </CardTitle>
            <CardDescription>Section 22 — tenant-configurable autonomy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Tenant" value={dash.tenant.slug} />
            <Row label="Region" value={dash.tenant.region} />
            <Row label="Roles" value={dash.tenant.roles.join(', ')} />
            <div>
              <div className="text-xs text-muted-foreground mb-1">Autonomy level</div>
              <Select
                value={String(autonomy?.autonomyLevel ?? 1)}
                onValueChange={(v) => onSetAutonomy(Number(v))}
                disabled={!autonomy}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {autonomy?.levels.map((l) => (
                    <SelectItem key={l.level} value={String(l.level)}>
                      L{l.level} — {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {autonomy?.policies[0] && (
              <div className="rounded-md bg-muted/60 p-2 text-[11px] space-y-1">
                <Row label="Max spend Δ" value={`${autonomy.policies[0].maxSpendChangePct}%`} small />
                <Row label="Requires approval" value={autonomy.policies[0].requiresApproval ? 'Yes' : 'No'} small />
                <Row label="Risk threshold" value={fmtPct(autonomy.policies[0].riskThreshold)} small />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Segments */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="size-4 text-teal-600" /> Customer Segments
            </CardTitle>
            <CardDescription>Customer graph snapshot (analytical plane)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {dash.segments.map((s) => (
                <div key={s.segment} className="rounded-lg border p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{s.segment}</div>
                  <div className="text-lg font-semibold mt-0.5">{s.count}</div>
                  <div className="text-xs text-muted-foreground">avg LTV {fmtMoney(s.avgLtv)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="size-4 text-emerald-600" /> Recent Events
            </CardTitle>
            <CardDescription>Durable event bus (Section 8)</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-72 overflow-y-auto pr-1 -mr-1 space-y-2">
              {dash.recentEvents.length === 0 && <Empty label="No events" />}
              {dash.recentEvents.map((e) => (
                <div key={e.id} className="text-xs border-l-2 border-emerald-500/40 pl-2 py-1">
                  <div className="font-medium">{e.type}</div>
                  <div className="text-muted-foreground">
                    {e.source} · {fmtDateTime(e.occurredAt)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Raw data + connectors snapshot */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="size-4 text-fuchsia-600" /> Raw Records (data plane)
          </CardTitle>
          <CardDescription>
            RAW → ADAPTER → CANONICAL → QUALITY → TRUSTED. Source records are retained verbatim (Section 10).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dash.rawRecords.length === 0 ? (
            <Empty label="No raw records ingested yet — sync a connector in the Data Sources tab." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
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
                      <td className="py-1.5 pr-3 font-mono text-[11px]">{r.sourceRecordId.slice(0, 28)}…</td>
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
    </div>
  )
}

function Kpi({ icon: Icon, label, value, accent }: { icon: typeof DollarSign; label: string; value: string; accent: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`size-3.5 ${accent}`} />
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </Card>
  )
}

function Row({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${small ? 'text-[11px]' : 'text-sm'}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return <div className="text-xs text-muted-foreground italic py-3 text-center">{label}</div>
}
