// Bootstrap VectorStore adapter — stores vectors as JSON in Postgres.
// Production: pgvector or dedicated vector DB (Pinecone/Weaviate) behind
// the same interface. Uses cosine similarity computed in JS for small datasets.

import type { VectorStorePort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'
import { t } from '../../tenant-guard'
import { requireTenantId } from '../../tenant-context'

// We store vectors in a dedicated table (VectorPoint) — added to schema.
// For bootstrap, we use a JSON column. For production, switch to pgvector.

interface StoredPoint {
  id: string
  tenantId: string
  vector: number[]
  metadata: Record<string, unknown> | null
}

// In-memory store for bootstrap (production would use pgvector)
const points = new Map<string, StoredPoint>()

function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

export const InMemoryVectorStore: VectorStorePort = {
  async upsert(ctx, point) {
    const tid = requireTenantId()
    const pk = `${tid}:${point.id}`
    points.set(pk, { id: point.id, tenantId: tid, vector: point.vector, metadata: point.metadata ?? null })
  },

  async upsertBatch(ctx, pts) {
    const tid = requireTenantId()
    for (const p of pts) {
      points.set(`${tid}:${p.id}`, { id: p.id, tenantId: tid, vector: p.vector, metadata: p.metadata ?? null })
    }
  },

  async search(ctx, query, opts) {
    const tid = requireTenantId()
    const topK = opts?.topK ?? 10
    const minScore = opts?.minScore ?? 0
    const results: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> = []
    for (const [pk, p] of points) {
      if (p.tenantId !== tid) continue // tenant isolation
      const score = cosineSim(query, p.vector)
      if (score >= minScore) {
        results.push({ id: p.id, score, metadata: p.metadata ?? undefined })
      }
    }
    return results.sort((a, b) => b.score - a.score).slice(0, topK)
  },

  async delete(ctx, id) {
    const tid = requireTenantId()
    points.delete(`${tid}:${id}`)
  },

  async ensureNamespace(ctx) {
    // No-op for in-memory; production would create a namespace/collection
    void ctx
  },
}
