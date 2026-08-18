'use client'

import { useState } from 'react'
import {
  AlertCircle, ArrowRight, Brain, Lightbulb, Loader2, Sparkles, Target,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

interface Diagnosis {
  company?: string
  observed?: string[]
  inferred?: string[]
  predicted?: string[]
  opportunities?: Array<{ title: string; description: string; evidence: string; confidence: number; expectedImpact: string }>
  recommendedExperiments?: Array<{ name: string; hypothesis: string; methodology: string; why: string }>
  uncertainty?: string
  nextStep?: string
  mardiFit?: string
}

export function DiagnosticTool() {
  const [form, setForm] = useState({ company: '', website: '', industry: '', size: '', notes: '' })
  const [loading, setLoading] = useState(false)
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null)
  const [meta, setMeta] = useState<{ provider: string; model: string; fellBack: boolean } | null>(null)

  async function run() {
    if (!form.company) return
    setLoading(true)
    setDiagnosis(null)
    try {
      const res = await fetch('/api/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      setDiagnosis(data.diagnosis)
      setMeta({ provider: data.provider, model: data.model, fellBack: data.fellBack })
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-background to-muted/30">
      <header className="border-b bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-4 flex items-center gap-3">
          <div className="size-9 rounded-lg bg-primary text-primary-foreground grid place-items-center font-bold">MD</div>
          <div>
            <div className="text-sm font-semibold">MARDI — Marketing Growth Diagnostic</div>
            <div className="text-[11px] text-muted-foreground">Free · Evidence-backed · No signup required</div>
          </div>
          <div className="flex-1" />
          <a href="/" className="text-xs text-muted-foreground hover:text-foreground">← Back to platform</a>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-3xl px-4 py-8 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-5 text-fuchsia-600" />
              Get your marketing growth diagnosis
            </CardTitle>
            <CardDescription>
              We'll analyze your company's public marketing signals and produce an evidence-backed diagnosis —
              distinguishing what we can <strong>observe</strong>, what we <strong>infer</strong>, what we <strong>predict</strong>,
              and what we <strong>recommend</strong>. No fabricated metrics.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Company name *</Label>
                <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="h-9 text-sm" placeholder="Acme Coffee Co." />
              </div>
              <div>
                <Label className="text-xs">Website</Label>
                <Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} className="h-9 text-sm" placeholder="https://acme.com" />
              </div>
              <div>
                <Label className="text-xs">Industry</Label>
                <Input value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} className="h-9 text-sm" placeholder="DTC e-commerce / coffee" />
              </div>
              <div>
                <Label className="text-xs">Company size</Label>
                <Select value={form.size} onValueChange={(v) => setForm({ ...form, size: v })}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="startup">Startup (1-10)</SelectItem>
                    <SelectItem value="small">Small (11-50)</SelectItem>
                    <SelectItem value="mid">Mid (51-200)</SelectItem>
                    <SelectItem value="enterprise">Enterprise (200+)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Additional context (optional)</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="text-sm min-h-16" placeholder="Anything else we should know — current channels, challenges, goals…" />
            </div>
            <Button onClick={run} disabled={loading || !form.company} className="w-full gap-2">
              {loading ? <><Loader2 className="size-4 animate-spin" /> Analyzing…</> : <><Brain className="size-4" /> Run diagnosis</>}
            </Button>
          </CardContent>
        </Card>

        {diagnosis && (
          <div className="space-y-4">
            {meta?.fellBack && (
              <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 p-2 text-[11px] text-amber-900 dark:text-amber-100 flex items-center gap-2">
                <AlertCircle className="size-3.5" />
                Running in fallback mode (LLM API unavailable). The structure is correct but reasoning is limited.
              </div>
            )}

            {diagnosis.observed && diagnosis.observed.length > 0 && (
              <Section title="Observed" color="text-teal-700 dark:text-teal-300" icon={Target} items={diagnosis.observed} />
            )}
            {diagnosis.inferred && diagnosis.inferred.length > 0 && (
              <Section title="Inferred" color="text-amber-700 dark:text-amber-300" items={diagnosis.inferred} />
            )}
            {diagnosis.predicted && diagnosis.predicted.length > 0 && (
              <Section title="Predicted" color="text-fuchsia-700 dark:text-fuchsia-300" items={diagnosis.predicted} />
            )}

            {diagnosis.opportunities && diagnosis.opportunities.length > 0 && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Lightbulb className="size-4 text-orange-600" /> Opportunities</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {diagnosis.opportunities.map((o, i) => (
                    <div key={i} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-sm">{o.title}</span>
                        <Badge variant="outline" className="text-[10px] h-5">{Math.round(o.confidence * 100)}% confidence</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">{o.description}</div>
                      <div className="text-[11px] text-muted-foreground mt-1"><span className="font-medium">Evidence:</span> {o.evidence}</div>
                      <div className="text-[11px] text-muted-foreground"><span className="font-medium">Expected impact:</span> {o.expectedImpact}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {diagnosis.recommendedExperiments && diagnosis.recommendedExperiments.length > 0 && (
              <Card>
                <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="size-4 text-emerald-600" /> Recommended Experiments</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {diagnosis.recommendedExperiments.map((e, i) => (
                    <div key={i} className="border rounded-md p-2 text-xs">
                      <div className="font-medium">{e.name} <Badge variant="outline" className="text-[9px] h-4 ml-1">{e.methodology}</Badge></div>
                      <div className="text-muted-foreground mt-0.5">{e.hypothesis}</div>
                      <div className="text-muted-foreground mt-0.5"><span className="font-medium">Why:</span> {e.why}</div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {diagnosis.uncertainty && (
              <Card className="p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Uncertainty</div>
                <div className="text-xs">{diagnosis.uncertainty}</div>
              </Card>
            )}

            {diagnosis.mardiFit && (
              <Card className="p-4 bg-primary/5 border-primary/30">
                <div className="text-[10px] uppercase tracking-wide text-primary mb-1 font-medium">Why MARDI</div>
                <div className="text-sm">{diagnosis.mardiFit}</div>
                <Button className="mt-3 gap-1.5" size="sm">
                  Get the full MARDI platform <ArrowRight className="size-3.5" />
                </Button>
              </Card>
            )}

            {diagnosis.nextStep && (
              <Card className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900">
                <div className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-1 font-medium">Recommended next step</div>
                <div className="text-sm text-emerald-900 dark:text-emerald-100">{diagnosis.nextStep}</div>
              </Card>
            )}

            {meta && (
              <div className="text-[10px] text-muted-foreground text-center">
                Generated by {meta.provider} / {meta.model}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function Section({ title, color, icon: Icon, items }: { title: string; color: string; icon?: typeof Target; items: string[] }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className={`text-sm flex items-center gap-2 ${color}`}>{Icon && <Icon className="size-4" />}{title}</CardTitle></CardHeader>
      <CardContent>
        <ul className="text-xs space-y-1 list-disc list-inside">
          {items.map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      </CardContent>
    </Card>
  )
}
