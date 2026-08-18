'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Lightbulb, Sparkles, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { toast } from 'sonner'
import { type OpportunityT, type RecommendationT, apiFetch, fmtMoney, fmtPct } from './types'

interface Props {
  tenant: string
}

export function RecommendationsTab({ tenant }: Props) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)

  const q = useQuery({
    queryKey: ['recommendations', tenant],
    queryFn: () => apiFetch<{ recommendations: RecommendationT[]; opportunities: OpportunityT[] }>(
      '/api/recommendations', tenant
    ),
    refetchInterval: 30_000,
  })

  async function detect() {
    const t = toast.loading('Running decision engine…')
    try {
      const r = await apiFetch<{ opportunities: OpportunityT[] }>(
        '/api/recommendations', tenant, { method: 'POST', body: { action: 'detect' } }
      )
      toast.success(`${r.opportunities.length} opportunities detected`, { id: t })
      qc.invalidateQueries({ queryKey: ['recommendations', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  async function persist(opp: OpportunityT) {
    setBusy(opp.description)
    const t = toast.loading('Recording recommendation…')
    try {
      await apiFetch('/api/recommendations', tenant, {
        method: 'POST', body: { action: 'create', opportunity: opp },
      })
      toast.success('Recommendation recorded with evidence links', { id: t })
      qc.invalidateQueries({ queryKey: ['recommendations', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    } finally {
      setBusy(null)
    }
  }

  const opps = q.data?.opportunities ?? []
  const recs = q.data?.recommendations ?? []

  return (
    <div className="space-y-5">
      {/* Decision engine banner */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="size-4 text-orange-600" /> Decision Engine
              </CardTitle>
              <CardDescription className="mt-1">
                Section 15 — inputs: business state, causal evidence, predictions, constraints. Outputs: opportunities + recommendations + evidence + uncertainty.
              </CardDescription>
            </div>
            <Button size="sm" onClick={detect} className="gap-1.5">
              <Sparkles className="size-3.5" />
              Detect opportunities
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {opps.length === 0 && (
              <div className="md:col-span-2 text-xs text-muted-foreground italic py-3 text-center">
                Click <span className="font-medium">Detect opportunities</span> to run the decision engine.
              </div>
            )}
            {opps.map((o, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-sm flex items-center gap-2">
                    <OppIcon type={o.type} />
                    {o.description}
                  </div>
                  <Badge variant="outline" className="text-[10px] h-5 capitalize shrink-0">{o.type.replace('_', ' ')}</Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Metric label="Exp. profit" value={fmtMoney(o.expectedIncrementalProfit)} positive />
                  <Metric label="Exp. revenue" value={fmtMoney(o.expectedIncrementalRevenue)} />
                  <Metric label="Confidence" value={fmtPct(o.confidence)} />
                </div>

                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">
                    Uncertainty: [{fmtPct(o.uncertainty.low)}, {fmtPct(o.uncertainty.high)}]
                  </div>
                  <div className="relative h-1.5 bg-muted rounded">
                    <div
                      className="absolute h-full bg-amber-500/60 rounded"
                      style={{
                        left: `${Math.max(0, o.uncertainty.low * 100)}%`,
                        width: `${Math.min(100, (o.uncertainty.high - o.uncertainty.low) * 100)}%`,
                      }}
                    />
                  </div>
                </div>

                {o.evidence.length > 0 && (
                  <div className="rounded-md bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 p-2">
                    <div className="text-[10px] uppercase tracking-wide text-rose-700 dark:text-rose-300 font-medium mb-1">Evidence</div>
                    {o.evidence.map((ev, j) => (
                      <div key={j} className="text-[11px] text-rose-900 dark:text-rose-100">
                        <span className="font-mono text-[10px] text-rose-600 dark:text-rose-400">{ev.type}#{ev.id.slice(-6)}</span>
                        <div>{ev.summary}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-[11px] text-muted-foreground">
                  <span className="font-medium">Next experiment:</span> {o.nextBestExperiment}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  {o.risks.length > 0 && (
                    <div className="text-[11px] flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="size-3" /> {o.risks.length} risk{o.risks.length !== 1 ? 's' : ''}
                    </div>
                  )}
                  <Button
                    size="sm" variant="outline" className="ml-auto h-7 text-xs gap-1"
                    onClick={() => persist(o)}
                    disabled={busy === o.description}
                  >
                    <CheckCircle2 className="size-3" />
                    Record recommendation
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recorded recommendations */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="size-4 text-emerald-600" /> Recorded Recommendations
          </CardTitle>
          <CardDescription>Each recommendation is linked to evidence via the Evidence Graph.</CardDescription>
        </CardHeader>
        <CardContent>
          {recs.length === 0 && <div className="text-xs text-muted-foreground italic py-3 text-center">No recommendations recorded yet.</div>}
          <div className="space-y-2">
            {recs.map((r) => (
              <div key={r.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm font-medium">{r.recommendation}</div>
                  <Badge variant="outline" className="text-[10px] h-5 shrink-0 capitalize">{r.status}</Badge>
                </div>
                <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                  <span>Exp. profit: <span className="font-medium text-emerald-700">{fmtMoney(r.expectedIncrementalProfit)}</span></span>
                  <span>Confidence: <span className="font-medium">{fmtPct(r.confidence)}</span></span>
                  <span>By: {r.generatedBy}</span>
                </div>
                {r.nextBestExperiment && (
                  <div className="text-[11px] text-muted-foreground mt-1">
                    <span className="font-medium">Next experiment:</span> {r.nextBestExperiment}
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function OppIcon({ type }: { type: string }) {
  if (type === 'scale') return <TrendingUp className="size-4 text-emerald-600" />
  if (type === 'pause') return <AlertTriangle className="size-4 text-amber-600" />
  if (type === 'experiment') return <Sparkles className="size-4 text-fuchsia-600" />
  return <Lightbulb className="size-4 text-orange-600" />
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-md bg-muted/60 p-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`font-semibold ${positive ? 'text-emerald-700' : ''}`}>{value}</div>
    </div>
  )
}
