'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, CheckCircle2, Clock, ScrollText } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { type DecisionT, type RecommendationT, apiFetch, fmtMoney, fmtPct, fmtDateTime } from './types'

export function DecisionsTab({ tenant }: { tenant: string }) {
  const qc = useQueryClient()

  const decisionsQ = useQuery({
    queryKey: ['decisions', tenant],
    queryFn: () => apiFetch<{ decisions: DecisionT[] }>('/api/decisions', tenant),
  })
  const recsQ = useQuery({
    queryKey: ['recommendations', tenant],
    queryFn: () => apiFetch<{ recommendations: RecommendationT[] }>('/api/recommendations', tenant),
  })

  const pendingRecs = recsQ.data?.recommendations.filter((r) => r.status === 'proposed') ?? []

  async function recordDecision(recId: string) {
    const t = toast.loading('Recording decision in ledger…')
    try {
      await apiFetch('/api/decisions', tenant, {
        method: 'POST',
        body: { recommendationId: recId, actionTaken: 'approved for execution' },
      })
      toast.success('Decision recorded (immutable)', { id: t })
      qc.invalidateQueries({ queryKey: ['decisions', tenant] })
      qc.invalidateQueries({ queryKey: ['recommendations', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  async function recordOutcome(decisionId: string) {
    const t = toast.loading('Closing the learning loop…')
    try {
      await apiFetch('/api/decisions', tenant, {
        method: 'POST',
        body: {
          action: 'outcome',
          decisionId,
          actualOutcome: { revenue: 0, status: 'pending measurement' },
          learning: 'Outcome recorded — pending full measurement window (14d).',
        },
      })
      toast.success('Learning recorded', { id: t })
      qc.invalidateQueries({ queryKey: ['decisions', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  const decisions = decisionsQ.data?.decisions ?? []

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ScrollText className="size-4 text-fuchsia-600" /> Decision Ledger
          </CardTitle>
          <CardDescription>
            Section 23 — immutable institutional memory. Every decision links to evidence, models, assumptions, and (later) actual outcome + learning.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pendingRecs.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 mb-4">
              <div className="text-xs font-medium text-amber-900 dark:text-amber-100 mb-2 flex items-center gap-1.5">
                <Clock className="size-3.5" /> Pending recommendations awaiting a decision
              </div>
              <div className="space-y-1.5">
                {pendingRecs.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0 truncate">{r.recommendation}</span>
                    <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1 shrink-0" onClick={() => recordDecision(r.id)}>
                      <CheckCircle2 className="size-3" /> Approve & record
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {decisions.length === 0 && (
            <div className="text-xs text-muted-foreground italic py-3 text-center">
              No decisions recorded yet. Generate & approve a recommendation first.
            </div>
          )}

          <div className="space-y-3">
            {decisions.map((d) => (
              <div key={d.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{d.recommendation}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Objective: {d.objective} · {fmtDateTime(d.createdAt)}
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px] h-5 shrink-0 capitalize">{d.status}</Badge>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-xs">
                  <Cell label="Confidence" value={fmtPct(d.confidence)} />
                  <Cell label="Evidence" value={`${d.evidence.length} link${d.evidence.length !== 1 ? 's' : ''}`} />
                  <Cell label="Models" value={d.modelsUsed.join(', ')} />
                  <Cell label="Assumptions" value={`${d.assumptions.length}`} />
                </div>

                {d.evidence.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Evidence chain</div>
                    <div className="flex flex-wrap gap-1.5">
                      {d.evidence.map((ev, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] h-5 font-mono">
                          {ev.relation} → {ev.targetType}#{ev.targetId.slice(-6)}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {d.actionTaken && (
                  <div className="text-[11px] text-muted-foreground mt-2">
                    <span className="font-medium">Action taken:</span> {d.actionTaken}
                  </div>
                )}

                {d.learning && (
                  <div className="mt-2 rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 p-2 text-[11px]">
                    <span className="font-medium text-emerald-900 dark:text-emerald-100">Learning:</span>{' '}
                    <span className="text-emerald-800 dark:text-emerald-200">{d.learning}</span>
                  </div>
                )}

                {d.status === 'recorded' && (
                  <Button size="sm" variant="outline" className="h-6 text-[11px] mt-2 gap-1" onClick={() => recordOutcome(d.id)}>
                    <BookOpen className="size-3" /> Record outcome + learning
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/60 p-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium truncate">{value}</div>
    </div>
  )
}
