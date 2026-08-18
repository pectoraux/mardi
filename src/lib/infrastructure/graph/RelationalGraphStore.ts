// Bootstrap GraphStore adapter — relational Edge table.
// Production: Neo4j or dedicated graph DB behind the same interface.
// The relational adapter preserves graph semantics (Section 12 + ADR-0002).

import type { GraphStorePort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'
import { t } from '../../tenant-guard'

export const RelationalGraphStore: GraphStorePort = {
  async addNode(ctx, node) {
    // Nodes are implicit in the relational model — they're identified by
    // (type, id) pairs referenced by edges. We store node properties as
    // a self-edge: (node.type, node.id) --properties--> (node.type, node.id)
    void ctx
    if (node.properties) {
      await t.edge.create({
        data: {
          sourceType: node.type,
          sourceId: node.id,
          relation: '_properties',
          targetType: node.type,
          targetId: node.id,
          weight: 1,
          metadata: JSON.stringify(node.properties),
        } as never,
      }).catch(() => {}) // idempotent — properties edge may already exist
    }
  },

  async addEdge(ctx, edge) {
    void ctx
    await t.edge.create({
      data: {
        sourceType: edge.sourceType,
        sourceId: edge.sourceId,
        relation: edge.relation,
        targetType: edge.targetType,
        targetId: edge.targetId,
        weight: edge.weight ?? 1,
        metadata: edge.properties ? JSON.stringify(edge.properties) : null,
      } as never,
    }).catch(() => {}) // idempotent via unique constraint
  },

  async traverse(ctx, start, opts) {
    const maxDepth = opts?.maxDepth ?? 2
    const limit = opts?.limit ?? 100
    const relationFilter = opts?.relationFilter

    const visited = new Set<string>()
    const nodes: Array<{ type: string; id: string; properties?: Record<string, unknown> }> = []
    const edges: Array<{ sourceType: string; sourceId: string; relation: string; targetType: string; targetId: string; weight: number }> = []

    const startKey = `${start.type}:${start.id}`
    nodes.push({ type: start.type, id: start.id })
    visited.add(startKey)

    // BFS
    let frontier = [start]
    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
      const nextFrontier: Array<{ type: string; id: string }> = []
      for (const node of frontier) {
        const outEdges = await t.edge.findMany({
          where: { sourceType: node.type, sourceId: node.id },
          take: limit,
        })
        for (const e of outEdges) {
          if (relationFilter && !relationFilter.includes(e.relation)) continue
          if (e.relation === '_properties') continue
          edges.push({
            sourceType: e.sourceType, sourceId: e.sourceId,
            relation: e.relation,
            targetType: e.targetType, targetId: e.targetId,
            weight: e.weight,
          })
          const targetKey = `${e.targetType}:${e.targetId}`
          if (!visited.has(targetKey)) {
            visited.add(targetKey)
            nodes.push({ type: e.targetType, id: e.targetId })
            nextFrontier.push({ type: e.targetType, id: e.targetId })
          }
        }
      }
      frontier = nextFrontier
    }
    return { nodes, edges }
  },

  async getEvidenceChain(ctx, node) {
    // 1-hop neighbors in both directions — the evidence chain
    const out = await t.edge.findMany({ where: { sourceType: node.type, sourceId: node.id } })
    const inc = await t.edge.findMany({ where: { targetType: node.type, targetId: node.id } })

    const nodes = new Map<string, { type: string; id: string }>()
    const ensure = (type: string, id: string) => {
      const key = `${type}:${id}`
      if (!nodes.has(key)) nodes.set(key, { type, id })
      return nodes.get(key)!
    }
    ensure(node.type, node.id)
    const edges: Array<{ sourceType: string; sourceId: string; relation: string; targetType: string; targetId: string; weight: number }> = []
    for (const e of [...out, ...inc]) {
      if (e.relation === '_properties') continue
      edges.push({
        sourceType: e.sourceType, sourceId: e.sourceId, relation: e.relation,
        targetType: e.targetType, targetId: e.targetId, weight: e.weight,
      })
      ensure(e.sourceType, e.sourceId)
      ensure(e.targetType, e.targetId)
    }
    return { nodes: Array.from(nodes.values()), edges }
  },
}
