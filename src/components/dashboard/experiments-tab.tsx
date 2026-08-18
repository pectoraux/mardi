'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, Plus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { toast } from 'sonner'
import { type ExperimentT, apiFetch, fmtPct } from './types'

const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-800 border-slate-300',
  running: 'bg-amber-100 text-amber-800 border-amber-300',
  completed: 'bg-teal-100 text-teal-800 border-teal-300',
  analyzed: 'bg-emerald-100 text-emerald-800 border-emerald-300',
}

export function ExperimentsTab({ tenant }: { tenant: string }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', hypothesis: '', primaryMetric: 'conversions', methodology: 'ab_test' })

  const q = useQuery({
    queryKey: ['experiments', tenant],
    queryFn: () => apiFetch<{ experiments: ExperimentT[] }>('/api/experiments', tenant),
  })

  async function createExperiment() {
    if (!form.name || !form.hypothesis) {
      toast.error('Name and hypothesis are required')
      return
    }
    const t = toast.loading('Creating experiment…')
    try {
      await apiFetch('/api/experiments', tenant, {
        method: 'POST',
        body: { ...form, objective: form.primaryMetric },
      })
      toast.success('Experiment created', { id: t })
      setForm({ name: '', hypothesis: '', primaryMetric: 'conversions', methodology: 'ab_test' })
      setShowForm(false)
      qc.invalidateQueries({ queryKey: ['experiments', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 120), { id: t })
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <FlaskConical className="size-4 text-emerald-600" /> Experiments
              </CardTitle>
              <CardDescription className="mt-1">
                Section 13 — durable organizational knowledge. An experiment never disappears after the dashboard is viewed.
              </CardDescription>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => setShowForm((v) => !v)}>
              <Plus className="size-3.5" />
              New
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {showForm && (
            <div className="rounded-lg border p-3 mb-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-8 text-sm" placeholder="e.g. Cold Brew Holdout Q1" />
                </div>
                <div>
                  <Label className="text-xs">Primary metric</Label>
                  <Input value={form.primaryMetric} onChange={(e) => setForm({ ...form, primaryMetric: e.target.value })} className="h-8 text-sm" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Hypothesis</Label>
                <Textarea value={form.hypothesis} onChange={(e) => setForm({ ...form, hypothesis: e.target.value })} className="text-sm min-h-20" placeholder="What do you expect to learn?" />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Methodology</Label>
                <Select value={form.methodology} onValueChange={(v) => setForm({ ...form, methodology: v })}>
                  <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ab_test">A/B Test</SelectItem>
                    <SelectItem value="holdout">Holdout</SelectItem>
                    <SelectItem value="geo">Geo Experiment</SelectItem>
                    <SelectItem value="uplift">Uplift Modeling</SelectItem>
                    <SelectItem value="mmm">Marketing Mix Model</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={createExperiment} className="ml-auto">Create</Button>
              </div>
            </div>
          )}

          {q.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
          {q.data?.experiments.length === 0 && <div className="text-xs text-muted-foreground italic py-3 text-center">No experiments yet.</div>}

          <div className="space-y-3">
            {q.data?.experiments.map((e) => (
              <div key={e.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{e.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {e.methodology} · {e.durationDays}d · primary: {e.primaryMetric}
                    </div>
                  </div>
                  <Badge variant="outline" className={`text-[10px] h-5 shrink-0 ${STATUS_COLOR[e.status] ?? ''}`}>
                    {e.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-2">
                  <span className="font-medium text-foreground">Hypothesis:</span> {e.hypothesis}
                </div>
                {e.decision && (
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] h-5">
                      decision: {e.decision}
                    </Badge>
                    {e.decision === 'ship' && (
                      <span className="text-[11px] text-emerald-700">✓ Causal evidence supports shipping</span>
                    )}
                  </div>
                )}
                {e.learning && (
                  <div className="mt-2 rounded-md bg-muted/60 p-2 text-[11px]">
                    <span className="font-medium">Learning:</span> {e.learning}
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
