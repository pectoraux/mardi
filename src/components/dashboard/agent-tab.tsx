'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Brain, Loader2, Send, Shield, Sparkles, Wrench } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { type AgentResultT, apiFetch, fmtMoney } from './types'

interface Turn {
  role: 'user' | 'assistant'
  content: string
  result?: AgentResultT
}

const SUGGESTED = [
  'What should we do next with our marketing budget? Show me the evidence.',
  'Which campaign has the strongest causal evidence? How confident are we?',
  'What experiment would most efficiently reduce our uncertainty?',
  'Where should the next dollar go — acquisition or retention?',
]

export function AgentTab({ tenant }: { tenant: string }) {
  const qc = useQueryClient()
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  async function ask(prompt: string) {
    if (!prompt.trim() || busy) return
    setBusy(true)
    const newTurns: Turn[] = [...turns, { role: 'user', content: prompt }]
    setTurns(newTurns)
    setInput('')
    const t = toast.loading('Strategy agent reasoning…')
    try {
      const history = newTurns.slice(-6).map((x) => ({ role: x.role, content: x.content }))
      const result = await apiFetch<AgentResultT>('/api/agent', tenant, {
        method: 'POST',
        body: { prompt, history },
      })
      setTurns([...newTurns, { role: 'assistant', content: result.structured?.summary ?? result.answer, result }])
      toast.success(`Answered in ${(result.latencyMs / 1000).toFixed(1)}s · ${result.tokens.input + result.tokens.output} tokens`, { id: t })
      qc.invalidateQueries({ queryKey: ['dashboard', tenant] })
    } catch (e) {
      toast.error(String(e).slice(0, 160), { id: t })
      setTurns([...newTurns, { role: 'assistant', content: `Error: ${String(e).slice(0, 200)}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="size-4 text-fuchsia-600" /> Strategy Agent
          </CardTitle>
          <CardDescription>
            Section 18 — specialized agent with typed tool contracts. Tenant-scoped, authorized, logged, auditable.
            Distinguishes OBSERVED / INFERRED / PREDICTED / RECOMMENDED (Section 35).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Safety banner */}
          <div className="rounded-md bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 p-2 mb-4 flex items-start gap-2">
            <Shield className="size-4 text-emerald-600 mt-0.5 shrink-0" />
            <div className="text-[11px] text-emerald-900 dark:text-emerald-100">
              <span className="font-medium">AI safety:</span> this agent never invents evidence. Every recommendation is grounded via tool calls to the Evidence Graph. It can only see <span className="font-medium">{tenant}</span> data.
            </div>
          </div>

          {/* Conversation */}
          <div className="space-y-3 min-h-40">
            {turns.length === 0 && (
              <div className="text-center py-6">
                <Sparkles className="size-8 text-fuchsia-600 mx-auto mb-2 opacity-60" />
                <div className="text-sm font-medium">Ask the Strategy Agent anything</div>
                <div className="text-xs text-muted-foreground mt-1">It will ground its answer in your tenant's causal evidence.</div>
                <div className="flex flex-wrap justify-center gap-2 mt-4 max-w-2xl mx-auto">
                  {SUGGESTED.map((s) => (
                    <Button key={s} variant="outline" size="sm" className="text-xs h-7" onClick={() => ask(s)}>
                      {s.slice(0, 50)}…
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn, i) => (
              <div key={i} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg p-3 text-sm ${turn.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted border'}`}>
                  {turn.role === 'user' ? (
                    turn.content
                  ) : turn.result ? (
                    <AgentAnswer result={turn.result} />
                  ) : (
                    turn.content
                  )}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex justify-start">
                <div className="bg-muted border rounded-lg p-3 flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin text-fuchsia-600" />
                  Gathering evidence via tools…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="mt-4 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the Strategy Agent…"
              className="min-h-10 max-h-32 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  ask(input)
                }
              }}
            />
            <Button onClick={() => ask(input)} disabled={busy || !input.trim()} className="gap-1.5 self-end">
              <Send className="size-4" />
              Ask
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function AgentAnswer({ result }: { result: AgentResultT }) {
  const s = result.structured
  if (!s) {
    return <pre className="text-xs whitespace-pre-wrap font-mono">{result.answer.slice(0, 2000)}</pre>
  }
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium">{s.summary}</div>

      {s.observed.length > 0 && (
        <Section title="Observed" color="text-teal-700 dark:text-teal-300" items={s.observed} />
      )}
      {s.inferred.length > 0 && (
        <Section title="Inferred" color="text-amber-700 dark:text-amber-300" items={s.inferred} />
      )}
      {s.predicted.length > 0 && (
        <Section title="Predicted" color="text-fuchsia-700 dark:text-fuchsia-300" items={s.predicted} />
      )}
      {s.recommended.length > 0 && (
        <Section title="Recommended" color="text-emerald-700 dark:text-emerald-300" items={s.recommended} />
      )}

      {s.evidence.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-rose-700 dark:text-rose-300 font-medium mb-1">Evidence</div>
          <div className="space-y-1">
            {s.evidence.map((ev, i) => (
              <div key={i} className="text-[11px] bg-rose-50 dark:bg-rose-950/30 rounded p-1.5">
                <span className="font-mono text-[10px] text-rose-600 dark:text-rose-400">{ev.type}#{ev.id.slice(-8)}</span>
                <div className="text-rose-900 dark:text-rose-100">{ev.summary}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] text-muted-foreground border-t pt-2">
        <span className="font-medium">Uncertainty:</span> {s.uncertainty}
      </div>
      <div className="text-[11px] text-muted-foreground">
        <span className="font-medium">Next best experiment:</span> {s.nextBestExperiment}
      </div>

      {/* Tool calls + cost */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
        <Wrench className="size-3 text-muted-foreground" />
        {result.toolCalls.map((tc, i) => (
          <Badge key={i} variant="outline" className={`text-[10px] h-5 ${tc.ok ? 'text-emerald-700' : 'text-destructive'}`}>
            {tc.tool}
          </Badge>
        ))}
        <span className="text-[10px] text-muted-foreground ml-auto">
          {result.tokens.input + result.tokens.output} tokens · {(result.latencyMs / 1000).toFixed(1)}s
        </span>
      </div>
    </div>
  )
}

function Section({ title, color, items }: { title: string; color: string; items: string[] }) {
  return (
    <div>
      <div className={`text-[10px] uppercase tracking-wide font-medium mb-1 ${color}`}>{title}</div>
      <ul className="text-xs space-y-0.5 list-disc list-inside">
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}

void fmtMoney
