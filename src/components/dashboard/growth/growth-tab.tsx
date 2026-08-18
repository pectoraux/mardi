'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, ArrowRight, CheckCircle2, Clock, DollarSign, Mail,
  Target, TrendingUp, Users, Zap,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { apiFetch, fmtMoney, fmtPct, fmtDateTime } from '../types'

interface GrowthDashboard {
  capital: {
    verifiedAvailable: number
    syntheticAvailable: number
    earnedRevenue: number
    ownerFunded: number
    reinvestedProfit: number
    synthetic: number
    currency: string
    isZeroVerifiedCapital: boolean
  }
  funnel: {
    prospectsIdentified: number
    outreachSent: number
    outreachReplied: number
    responseRate: number
    totalExposure: number
    totalLeads: number
    totalQualified: number
    totalSignups: number
    totalCustomers: number
    totalRevenue: number
  }
  experiments: Array<{
    id: string; name: string; acquisitionMechanism: string; status: string
    cost: number; effortHours: number; exposure: number; leads: number
    qualifiedLeads: number; customers: number; revenue: number
    decision: string | null; learning: string | null
  }>
  mechanisms: Array<{ mechanism: string; exposure: number; leads: number; customers: number; revenue: number }>
  pendingApprovals: number
  cashSpend: number
}

export function GrowthTab({ tenant }: { tenant: string }) {
  const qc = useQueryClient()
  const dashQ = useQuery({
    queryKey: ['growth-dashboard', tenant],
    queryFn: () => apiFetch<GrowthDashboard>('/api/growth/dashboard', tenant),
    refetchInterval: 15_000,
  })

  const prospectsQ = useQuery({
    queryKey: ['growth-prospects', tenant],
    queryFn: () => apiFetch<{ prospects: Array<Record<string, unknown>> }>('/api/growth/prospects', tenant),
  })

  const outreachesQ = useQuery({
    queryKey: ['growth-outreach', tenant],
    queryFn: () => apiFetch<{ outreaches: Array<Record<string, unknown>> }>('/api/growth/outreach', tenant),
  })

  const d = dashQ.data
  if (!d) return <div className="text-xs text-muted-foreground">Loading growth dashboard…</div>

  return (
    <div className="space-y-5">
      {/* Capital provenance banner */}
      <Card className={d.capital.isZeroVerifiedCapital ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/10' : ''}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="size-4 text-amber-600" /> Capital Provenance
          </CardTitle>
          <CardDescription>
            Synthetic capital is tracked but CANNOT authorize real-world spending. Only verified capital counts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CapitalStat label="Verified Available" value={fmtMoney(d.capital.verifiedAvailable)} highlight={d.capital.isZeroVerifiedCapital ? 'zero' : 'ok'} />
            <CapitalStat label="Earned Revenue" value={fmtMoney(d.capital.earnedRevenue)} />
            <CapitalStat label="Owner Funded" value={fmtMoney(d.capital.ownerFunded)} />
            <CapitalStat label="Synthetic (test)" value={fmtMoney(d.capital.syntheticAvailable)} muted />
          </div>
          {d.capital.isZeroVerifiedCapital && (
            <div className="mt-3 rounded-md bg-amber-100 dark:bg-amber-950/30 p-2 text-[11px] text-amber-900 dark:text-amber-100 flex items-center gap-2">
              <Zap className="size-3.5" />
              <span><strong>$0 verified capital.</strong> The system is running on zero-cost acquisition mechanisms only. Paid actions are blocked.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Funnel */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="size-4 text-emerald-600" /> Acquisition Funnel
          </CardTitle>
          <CardDescription>Zero-capital acquisition loop: prospect → outreach → response → customer</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            <FunnelStat icon={Target} label="Prospects" value={d.funnel.prospectsIdentified} />
            <FunnelStat icon={Mail} label="Outreach sent" value={d.funnel.outreachSent} />
            <FunnelStat icon={CheckCircle2} label="Replied" value={d.funnel.outreachReplied} />
            <FunnelStat icon={Users} label="Qualified" value={d.funnel.totalQualified} />
            <FunnelStat icon={Activity} label="Customers" value={d.funnel.totalCustomers} />
            <FunnelStat icon={DollarSign} label="Revenue" value={fmtMoney(d.funnel.totalRevenue)} />
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">Response rate: <span className="font-medium text-foreground">{fmtPct(d.funnel.responseRate)}</span></span>
            <span className="text-muted-foreground">Cash spend: <span className="font-medium text-emerald-700">$0</span></span>
            {d.pendingApprovals > 0 && (
              <Badge variant="outline" className="text-[10px] h-5 bg-amber-50 text-amber-700 border-amber-300">
                <Clock className="size-2.5 mr-1" />{d.pendingApprovals} pending approval
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Mechanism performance */}
      {d.mechanisms.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="size-4 text-fuchsia-600" /> Acquisition Mechanism Performance
            </CardTitle>
            <CardDescription>Which zero-cost mechanisms are producing results</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {d.mechanisms.map((m) => (
                <div key={m.mechanism} className="flex items-center gap-3 text-sm border-b last:border-0 py-2">
                  <span className="font-medium capitalize w-40">{m.mechanism.replace(/_/g, ' ')}</span>
                  <span className="text-muted-foreground text-xs">exposure: {m.exposure}</span>
                  <span className="text-muted-foreground text-xs">leads: {m.leads}</span>
                  <span className="text-muted-foreground text-xs">customers: {m.customers}</span>
                  <span className="text-muted-foreground text-xs ml-auto">revenue: {fmtMoney(m.revenue)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Experiments */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="size-4 text-teal-600" /> Growth Experiments
          </CardTitle>
          <CardDescription>Testing which acquisition mechanisms produce qualified customers</CardDescription>
        </CardHeader>
        <CardContent>
          {d.experiments.length === 0 && <div className="text-xs text-muted-foreground italic py-3 text-center">No growth experiments yet.</div>}
          <div className="space-y-3">
            {d.experiments.map((e) => (
              <div key={e.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{e.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                      {e.acquisitionMechanism.replace(/_/g, ' ')} · {e.effortHours}h effort · ${e.cost} cash
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-5 shrink-0">{e.status}</Badge>
                </div>
                {e.learning && (
                  <div className="mt-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 p-2 text-[11px] text-emerald-900 dark:text-emerald-100">
                    <span className="font-medium">Learning:</span> {e.learning}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Prospects + Outreach */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="size-4 text-amber-600" /> Prospects
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {prospectsQ.data?.prospects.length === 0 && <div className="text-xs text-muted-foreground italic py-3 text-center">No prospects yet.</div>}
              {prospectsQ.data?.prospects.map((p) => (
                <div key={p.id as string} className="border rounded-md p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{p.company as string}</span>
                    <Badge variant="outline" className="text-[9px] h-4">{p.status as string}</Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5">
                    {p.industry as string ?? '—'} · ICP fit {fmtPct(p.icpFitScore as number)} · source: {p.source as string}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="size-4 text-fuchsia-600" /> Outreach
            </CardTitle>
            <CardDescription>Human approval required before sending</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="max-h-80 overflow-y-auto space-y-2">
              {outreachesQ.data?.outreaches.length === 0 && <div className="text-xs text-muted-foreground italic py-3 text-center">No outreach yet.</div>}
              {outreachesQ.data?.outreaches.map((o) => (
                <div key={o.id as string} className="border rounded-md p-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{o.prospectCompany as string ?? '—'}</span>
                    <Badge variant="outline" className={`text-[9px] h-4 ${
                      o.status === 'sent' ? 'bg-emerald-50 text-emerald-700' :
                      o.status === 'replied' ? 'bg-teal-50 text-teal-700' :
                      o.status === 'approved' ? 'bg-blue-50 text-blue-700' :
                      'bg-muted'
                    }`}>{o.status as string}</Badge>
                  </div>
                  <div className="text-muted-foreground mt-0.5 truncate">{(o.subject as string) ?? (o.body as string)?.slice(0, 60) ?? '—'}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function CapitalStat({ label, value, highlight, muted }: { label: string; value: string; highlight?: 'zero' | 'ok'; muted?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight === 'zero' ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${muted ? 'text-muted-foreground' : highlight === 'zero' ? 'text-amber-700' : ''}`}>{value}</div>
    </div>
  )
}

function FunnelStat({ icon: Icon, label, value }: { icon: typeof Target; label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className="size-3 text-muted-foreground" />
      </div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  )
}
