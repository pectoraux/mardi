// =============================================================================
// Evidence Graph service (Section 11)
// =============================================================================
// First-class evidence graph: recommendations, model conclusions, and causal
// claims are linked to evidence via typed edges. Supports answering
// "Why did the system make this recommendation?" with a machine- and
// human-readable evidence chain.

import { t } from '../tenant-guard'

export interface EvidenceNode {
  type: string
  id: string
  label: string
  kind: 'recommendation' | 'experiment' | 'observation' | 'causal_estimate' | 'creative' | 'campaign' | 'model' | 'source'
}

export interface EvidenceEdge {
  source: EvidenceNode
  relation: string
  target: EvidenceNode
  weight: number
}

export async function linkEvidence(
  source: { type: string; id: string },
  relation: string,
  target: { type: string; id: string },
  opts?: { weight?: number; metadata?: Record<string, unknown> }
): Promise<void> {
  await t.edge.upsert({
    where: {
      tenantId_sourceType_sourceId_relation_targetType_targetId: {
        tenantId: '' /* filled by guard */,
        sourceType: source.type,
        sourceId: source.id,
        relation,
        targetType: target.type,
        targetId: target.id,
      },
    },
    create: {
      sourceType: source.type,
      sourceId: source.id,
      relation,
      targetType: target.type,
      targetId: target.id,
      weight: opts?.weight ?? 1,
      metadata: opts?.metadata ? JSON.stringify(opts.metadata) : null,
    },
    update: {
      weight: opts?.weight ?? 1,
      metadata: opts?.metadata ? JSON.stringify(opts.metadata) : null,
    },
  })
}

/** Fetch the evidence chain for a node (1-hop neighbors, both directions). */
export async function getEvidenceChain(node: { type: string; id: string }): Promise<{
  nodes: EvidenceNode[]
  edges: EvidenceEdge[]
}> {
  const out = await t.edge.findMany({ where: { sourceType: node.type, sourceId: node.id } })
  const inc = await t.edge.findMany({ where: { targetType: node.type, targetId: node.id } })

  const nodes = new Map<string, EvidenceNode>()
  const ensure = (type: string, id: string): EvidenceNode => {
    const key = `${type}:${id}`
    if (!nodes.has(key)) {
      nodes.set(key, { type, id, label: labelFor(type, id), kind: kindFor(type) })
    }
    return nodes.get(key)!
  }

  ensure(node.type, node.id)
  const edges: EvidenceEdge[] = []
  for (const e of out) {
    edges.push({
      source: ensure(e.sourceType, e.sourceId),
      relation: e.relation,
      target: ensure(e.targetType, e.targetId),
      weight: e.weight,
    })
  }
  for (const e of inc) {
    edges.push({
      source: ensure(e.sourceType, e.sourceId),
      relation: e.relation,
      target: ensure(e.targetType, e.targetId),
      weight: e.weight,
    })
  }
  return { nodes: Array.from(nodes.values()), edges }
}

/** Full evidence graph (all edges for the active tenant). */
export async function getFullGraph(limit = 500): Promise<{
  nodes: EvidenceNode[]
  edges: EvidenceEdge[]
}> {
  const rows = await t.edge.findMany({ take: limit, orderBy: { createdAt: 'desc' } })
  const nodes = new Map<string, EvidenceNode>()
  const ensure = (type: string, id: string): EvidenceNode => {
    const key = `${type}:${id}`
    if (!nodes.has(key)) {
      nodes.set(key, { type, id, label: labelFor(type, id), kind: kindFor(type) })
    }
    return nodes.get(key)!
  }
  const edges: EvidenceEdge[] = rows.map((e) => ({
    source: ensure(e.sourceType, e.sourceId),
    relation: e.relation,
    target: ensure(e.targetType, e.targetId),
    weight: e.weight,
  }))
  return { nodes: Array.from(nodes.values()), edges }
}

function labelFor(type: string, id: string): string {
  // Truncated id is acceptable as a fallback; richer labels are joined by the UI.
  return `${type}#${id.slice(-6)}`
}

function kindFor(type: string): EvidenceNode['kind'] {
  switch (type) {
    case 'Recommendation': return 'recommendation'
    case 'Experiment': return 'experiment'
    case 'CausalEstimate': return 'causal_estimate'
    case 'Observation': return 'observation'
    case 'Creative': return 'creative'
    case 'Campaign': return 'campaign'
    case 'Model': return 'model'
    case 'Source': return 'source'
    default: return 'observation'
  }
}
