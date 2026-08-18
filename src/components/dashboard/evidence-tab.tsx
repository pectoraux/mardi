'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Network, Search } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { type EvidenceGraph, apiFetch } from './types'

const KIND_COLOR: Record<string, string> = {
  recommendation: 'bg-orange-100 text-orange-800 border-orange-300',
  experiment: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  causal_estimate: 'bg-rose-100 text-rose-800 border-rose-300',
  observation: 'bg-teal-100 text-teal-800 border-teal-300',
  creative: 'bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300',
  campaign: 'bg-amber-100 text-amber-800 border-amber-300',
  model: 'bg-slate-100 text-slate-800 border-slate-300',
  source: 'bg-muted text-muted-foreground border-border',
}

export function EvidenceTab({ tenant }: { tenant: string }) {
  const [selected, setSelected] = useState<{ type: string; id: string } | null>(null)

  const fullQ = useQuery({
    queryKey: ['evidence-full', tenant],
    queryFn: () => apiFetch<EvidenceGraph>('/api/evidence', tenant),
  })

  const chainQ = useQuery({
    queryKey: ['evidence-chain', tenant, selected],
    queryFn: () =>
      apiFetch<EvidenceGraph>(
        `/api/evidence?type=${encodeURIComponent(selected!.type)}&id=${encodeURIComponent(selected!.id)}`,
        tenant
      ),
    enabled: !!selected,
  })

  const graph = selected ? chainQ.data : fullQ.data

  // Compute simple positions for visualization
  const layout = useMemo(() => {
    const g = graph
    if (!g) return { nodes: [] as Array<{ id: string; x: number; y: number; type: string; label: string; kind: string }>, edges: [] as Array<{ from: string; to: string; relation: string }> }
    const cx = 250, cy = 200, r = 130
    const center = selected ? `${selected.type}:${selected.id}` : null
    const nodes = g.nodes.map((n, i) => {
      const key = `${n.type}:${n.id}`
      if (key === center) return { id: key, x: cx, y: cy, type: n.type, label: n.label, kind: n.kind }
      const angle = (i / Math.max(g.nodes.length - 1, 1)) * Math.PI * 2
      return { id: key, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, type: n.type, label: n.label, kind: n.kind }
    })
    const edges = g.edges.map((e) => ({ from: `${e.source.type}:${e.source.id}`, to: `${e.target.type}:${e.target.id}`, relation: e.relation }))
    return { nodes, edges }
  }, [graph, selected])

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="size-4 text-rose-600" /> Evidence Graph
          </CardTitle>
          <CardDescription>
            Section 11 — every recommendation, causal claim & model conclusion is linked to evidence.
            Click any node to inspect its evidence chain.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* SVG graph */}
            <div className="rounded-lg border bg-muted/30 overflow-hidden">
              <div className="aspect-[5/4] relative">
                {fullQ.isLoading && <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Loading…</div>}
                {graph && graph.nodes.length === 0 && (
                  <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground italic">
                    No evidence edges yet. Generate recommendations first.
                  </div>
                )}
                {graph && graph.nodes.length > 0 && (
                  <svg viewBox="0 0 500 400" className="w-full h-full">
                    <defs>
                      <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                        <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" className="text-muted-foreground" />
                      </marker>
                    </defs>
                    {layout.edges.map((e, i) => {
                      const from = layout.nodes.find((n) => n.id === e.from)
                      const to = layout.nodes.find((n) => n.id === e.to)
                      if (!from || !to) return null
                      return (
                        <g key={i}>
                          <line
                            x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                            stroke="currentColor" className="text-muted-foreground/40"
                            strokeWidth={1.5} markerEnd="url(#arrow)"
                          />
                          <text
                            x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 4}
                            className="fill-muted-foreground text-[8px]"
                            textAnchor="middle"
                          >
                            {e.relation}
                          </text>
                        </g>
                      )
                    })}
                    {layout.nodes.map((n) => {
                      const isCenter = n.id === `${selected?.type}:${selected?.id}`
                      return (
                        <g key={n.id} className="cursor-pointer" onClick={() => setSelected({ type: n.type, id: n.id.split(':').slice(0, -1).join(':') + ':' + n.id.split(':').slice(-1)[0] })}>
                          <circle
                            cx={n.x} cy={n.y} r={isCenter ? 22 : 16}
                            className={KIND_COLOR[n.kind] ? `stroke-foreground/30` : 'fill-muted stroke-foreground/30'}
                            fill="currentColor"
                            opacity={0.85}
                          />
                          <text x={n.x} y={n.y + 4} className="fill-background text-[9px] font-medium pointer-events-none" textAnchor="middle">
                            {n.type[0]}
                          </text>
                          <text x={n.x} y={n.y + 32} className="fill-foreground text-[9px] pointer-events-none" textAnchor="middle">
                            {n.label}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                )}
              </div>
            </div>

            {/* Selected node chain */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Search className="size-4 text-muted-foreground" />
                <Input
                  placeholder="Inspect node: enter id suffix…"
                  className="h-8 text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = (e.target as HTMLInputElement).value
                      const match = fullQ.data?.nodes.find((n) => n.id.endsWith(v) || n.id.includes(v))
                      if (match) setSelected({ type: match.type, id: match.id })
                    }
                  }}
                />
              </div>
              {!selected && (
                <div className="text-xs text-muted-foreground italic">
                  Click a node in the graph to inspect its evidence chain.
                </div>
              )}
              {selected && (
                <Card className="p-3">
                  <div className="text-xs text-muted-foreground">Inspecting</div>
                  <div className="font-mono text-xs mt-1 break-all">{selected.type}#{selected.id.slice(-12)}</div>
                </Card>
              )}
              {chainQ.isLoading && <div className="text-xs text-muted-foreground">Loading chain…</div>}
              {chainQ.data && (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {chainQ.data.edges.length === 0 && (
                    <div className="text-xs text-muted-foreground italic">No evidence edges for this node.</div>
                  )}
                  {chainQ.data.edges.map((e, i) => (
                    <div key={i} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Badge variant="outline" className={`text-[10px] h-5 ${KIND_COLOR[e.source.kind] ?? ''}`}>
                          {e.source.type}
                        </Badge>
                        <span className="font-mono text-[10px] text-muted-foreground">{e.source.id.slice(-8)}</span>
                        <span className="font-medium text-foreground">—{e.relation}→</span>
                        <Badge variant="outline" className={`text-[10px] h-5 ${KIND_COLOR[e.target.kind] ?? ''}`}>
                          {e.target.type}
                        </Badge>
                        <span className="font-mono text-[10px] text-muted-foreground">{e.target.id.slice(-8)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-muted-foreground mr-1">Legend:</span>
          {Object.entries(KIND_COLOR).map(([k, cls]) => (
            <Badge key={k} variant="outline" className={`text-[10px] h-5 ${cls}`}>{k}</Badge>
          ))}
        </div>
      </Card>
    </div>
  )
}
