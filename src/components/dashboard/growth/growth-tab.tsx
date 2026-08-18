'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, ArrowRight, Check, CheckCircle2, Clock, DollarSign, Mail,
  Target, TrendingUp, Users, X, Zap,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { apiFetch, fmtMoney, fmtPct, fmtDateTime } from '../types'
import { ProspectWorkbench } from './prospect-workbench'

interface GrowthDashboard {
  headline: {
    verifiedCustomers: number
    paidSpend: number
    verifiedRevenue: number
    prospects: number
    outreachSent: number
  }
  capital: {
    verifiedAvailable: number
    syntheticAvailable: number
    earnedRevenue: number
    ownerFunded: number
    reinvestedProfit: number
    synthetic: number
    currency: string
    isZeroVerifiedCapital: boolean
    hasEarnedRealRevenue: boolean
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
  diagnosticFunnel: {
    total: number
    promotedToProspect: number
    rejected: number
    pendingReview: number
  }
  experiments: Array<{
    id: string; name: string; acquisitionMechanism: string; status: string
    cost: number; effortHours: number; exposure: number; leads: number
    qualifiedLeads: number; customers: number; revenue: number
    decision: string | null; learning: string | null
  }>
  mechanisms: Array<{ mechanism: string; exposure: number; leads: number; customers: number; revenue: number }>
  pendingApprovals: number
  drafts: number
  cashSpend: number
}

export function GrowthTab({ tenant }: { tenant: string }) {
  const qc = useQueryClient()
  const [view, setView] = useState<'workbench' | 'diagnostic_runs'>('workbench')

  const dashQ = useQuery({
    queryKey: ['growth-dashboard', tenant],
    queryFn: () => apiFetch<GrowthDashboard>('/api/growth/dashboard', tenant),
    refetchInterval: 15_000,
  })

  const d = dashQ.data
  if (!d) return <div className="text-xs text-muted-foreground">Loading growth dashboard…</div>

  return (
    <div className="space-y-5">
      {/* HEADLINE METRIC — the reviewer's #1 request */}
      <Card className={d.headline.verifiedCustomers > 0 ? 'border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20' : 'border-amber-300 bg-amber-50/30 dark:bg-amber-950/10'}>
        <CardContent className="py-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <HeadlineStat
              label="VERIFIED CUSTOMERS"
              value={String(d.headline.verifiedCustomers)}
              sub="$0 paid spend"
              highlight={d.headline.verifiedCustomers > 0 ? 'success' : 'pending'}
              icon={CheckCircle2}
            />
            <HeadlineStat label="PAID SPEND" value={fmtMoney(d.headline.paidSpend)} sub="this milestone" icon={DollarSign} />
            <HeadlineStat
              label="VERIFIED REVENUE"
              value={fmtMoney(d.headline.verifiedRevenue)}
              sub={d.capital.hasEarnedRealRevenue ? 'earned' : 'none yet'}
              highlight={d.capital.hasEarnedRealRevenue ? 'success' : 'pending'}
              icon={TrendingUp}
            />
            <HeadlineStat label="PROSPECTS" value={String(d.headline.prospects)} sub="qualified" icon={Target} />
            <HeadlineStat label="OUTREACH SENT" value={String(d.headline.outreachSent)} sub={`${fmtPct(d.funnel.responseRate)} replied`} icon={Mail} />
          </div>
          {d.headline.verifiedCustomers === 0 && (
            <div className="mt-3 text-[11px] text-amber-900 dark:text-amber-100 flex items-center gap-2">
              <Clock className="size-3.5" />
              <span><strong>0 verified customers acquired with $0 paid spend.</strong> The milestone is open. Promote diagnostic runs → generate outreach → approve → send → convert.</span>
            </div>
          )}
          {d.headline.verifiedCustomers > 0 && (
            <div className="mt-3 text-[11px] text-emerald-900 dark:text-emerald-100 flex items-center gap-2 font-medium">
              <CheckCircle2 className="size-3.5" />
              <span>Milestone achieved: {d.headline.verifiedCustomers} verified customer(s) acquired with $0 paid spend. {fmtMoney(d.headline.verifiedRevenue)} earned revenue now fuels the Growth Decision Engine.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Capital provenance */}
      <Card className={d.capital.isZeroVerifiedCapital ? 'border-amber-300' : 'border-emerald-300'}>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="size-4 text-amber-600" /> Capital Provenance
          </CardTitle>
          <CardDescription className="text-xs">
            Synthetic capital is tracked but CANNOT authorize real-world spending. Only verified capital counts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <CapitalStat label="Verified Available" value={fmtMoney(d.capital.verifiedAvailable)} highlight={d.capital.isZeroVerifiedCapital ? 'zero' : 'ok'} />
            <CapitalStat label="Earned Revenue" value={fmtMoney(d.capital.earnedRevenue)} highlight={d.capital.hasEarnedRealRevenue ? 'ok' : undefined} />
            <CapitalStat label="Owner Funded" value={fmtMoney(d.capital.ownerFunded)} />
            <CapitalStat label="Synthetic (test)" value={fmtMoney(d.capital.syntheticAvailable)} muted />
          </div>
        </CardContent>
      </Card>

      {/* View toggle */}
      <div className="flex items-center gap-2">
        <Button
          size="sm" variant={view === 'workbench' ? 'default' : 'outline'}
          onClick={() => setView('workbench')}
          className="gap-1.5"
        >
          <Target className="size-3.5" /> Prospect Workbench
        </Button>
        <Button
          size="sm" variant={view === 'diagnostic_runs' ? 'default' : 'outline'}
          onClick={() => setView('diagnostic_runs')}
          className="gap-1.5"
        >
          <Activity className="size-3.5" /> Diagnostic Runs
          {d.diagnosticFunnel.pendingReview > 0 && (
            <Badge variant="outline" className="text-[9px] h-4 ml-1 bg-amber-50 text-amber-700 border-amber-300">
              {d.diagnosticFunnel.pendingReview}
            </Badge>
          )}
        </Button>
      </div>

      {view === 'workbench' && <ProspectWorkbench tenant={tenant} />}
      {view === 'diagnostic_runs' && <DiagnosticRunsReview tenant={tenant} />}

      {/* Mechanism performance */}
      {d.mechanisms.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="size-4 text-fuchsia-600" /> Acquisition Mechanism Performance
            </CardTitle>
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
    </div>
  )
}

function DiagnosticRunsReview({ tenant }: { tenant: string }) {
  const qc = useQueryClient()
  const runsQ = useQuery({
    queryKey: ['diagnostic-runs', tenant],
    queryFn: () => apiFetch<{ runs: Array<Record<string, unknown>> }>('/api/growth/diagnostic-runs', tenant),
    refetchInterval: 10_000,
  })

  async function promote(runId: string) {
    const t = toast.loading('Promoting to prospect…')
    try {
      await apiFetch('/api/growth/diagnostic-runs', tenant, {
        method: 'POST', body: { action: 'promote_to_prospect', diagnosticRunId: runId },
      })
      toast.success('Promoted to prospect', { id: t })
      qc.invalidateQueries({ queryKey: ['diagnostic-runs', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-prospects', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-dashboard', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  async function reject(runId: string) {
    const t = toast.loading('Rejecting…')
    try {
      await apiFetch('/api/growth/diagnostic-runs', tenant, {
        method: 'POST', body: { action: 'reject', diagnosticRunId: runId },
      })
      toast.success('Rejected', { id: t })
      qc.invalidateQueries({ queryKey: ['diagnostic-runs', tenant] })
      qc.invalidateQueries({ queryKey: ['growth-dashboard', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  const runs = runsQ.data?.runs ?? []
  const pending = runs.filter((r) => r.stage === 'diagnostic_run' || r.stage === 'identified_organization')
  const reviewed = runs.filter((r) => r.stage !== 'diagnostic_run' && r.stage !== 'identified_organization')

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Diagnostic Runs — Review & Promote</CardTitle>
        <CardDescription className="text-xs">
          A visitor running the diagnostic tool is NOT automatically a prospect. Explicitly promote qualified ones.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {pending.length === 0 && <div className="text-xs text-muted-foreground italic py-3 text-center">No diagnostic runs pending review.</div>}
        <div className="space-y-3">
          {pending.map((r) => {
            const diag = r.diagnosis as Record<string, unknown>
            return (
              <div key={r.id as string} className="border rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{r.company as string}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.website as string ?? '—'} · {r.industry as string ?? '—'} · {fmtDateTime(r.createdAt as string)}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[9px] h-5 bg-amber-50 text-amber-700 border-amber-300">
                    {r.stage as string}
                  </Badge>
                </div>
                {diag && (
                  <div className="mt-2 text-[11px] space-y-1 bg-muted/40 rounded p-2 max-h-40 overflow-y-auto">
                    {diag.recommendedAngle && <div><span className="font-medium">Angle:</span> {String(diag.recommendedAngle)}</div>}
                    {diag.mardiFit && <div><span className="font-medium">MARDI fit:</span> {String(diag.mardiFit).slice(0, 200)}</div>}
                    {diag.nextStep && <div><span className="font-medium">Next step:</span> {String(diag.nextStep)}</div>}
                  </div>
                )}
                <div className="flex items-center gap-2 mt-2">
                  <Button size="sm" className="h-6 text-[11px] gap-1" onClick={() => promote(r.id as string)}>
                    <Check className="size-3" /> Promote to prospect
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" onClick={() => reject(r.id as string)}>
                    <X className="size-3" /> Reject
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
        {reviewed.length > 0 && (
          <div className="mt-4 pt-3 border-t">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Reviewed ({reviewed.length})</div>
            <div className="space-y-1">
              {reviewed.slice(0, 5).map((r) => (
                <div key={r.id as string} className="flex items-center justify-between text-[11px] py-1">
                  <span>{r.company as string}</span>
                  <Badge variant="outline" className={`text-[9px] h-4 ${r.stage === 'promoted_to_prospect' ? 'bg-emerald-50 text-emerald-700' : 'bg-destructive/5 text-destructive'}`}>
                    {r.stage as string}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function HeadlineStat({ label, value, sub, highlight, icon: Icon }: { label: string; value: string; sub: string; highlight?: 'success' | 'pending'; icon: typeof DollarSign }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`size-10 rounded-lg grid place-items-center shrink-0 ${
        highlight === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' :
        highlight === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' :
        'bg-muted text-muted-foreground'
      }`}>
        <Icon className="size-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
        <div className={`text-xl font-bold ${highlight === 'success' ? 'text-emerald-700 dark:text-emerald-300' : highlight === 'pending' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground truncate">{sub}</div>
      </div>
    </div>
  )
}

function CapitalStat({ label, value, highlight, muted }: { label: string; value: string; highlight?: 'zero' | 'ok'; muted?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight === 'zero' ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : highlight === 'ok' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${muted ? 'text-muted-foreground' : highlight === 'zero' ? 'text-amber-700' : highlight === 'ok' ? 'text-emerald-700' : ''}`}>{value}</div>
    </div>
  )
}
