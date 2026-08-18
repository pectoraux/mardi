// Bootstrap EmbeddingProvider — hash-based embeddings (deterministic, no API).
// Production: OpenAI text-embedding-3-small or Cohere embed adapter.
// The hash-based approach gives fixed-dimension vectors for bootstrap
// semantic search without an API call.

import type { EmbeddingProvider } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'
import { createHash } from 'node:crypto'

const DIMENSIONS = 256

function hashEmbed(text: string): number[] {
  const vector = new Array(DIMENSIONS).fill(0)
  // Tokenize and hash each token into the vector
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean)
  for (const token of tokens) {
    const hash = createHash('sha256').update(token).digest()
    for (let i = 0; i < DIMENSIONS; i++) {
      vector[i] += (hash[i % 32] / 128 - 0.5) * 0.1
    }
  }
  // Normalize
  const mag = Math.sqrt(vector.reduce((s, x) => s + x * x, 0))
  if (mag > 0) {
    for (let i = 0; i < DIMENSIONS; i++) vector[i] /= mag
  }
  return vector
}

export const HashEmbeddingProvider: EmbeddingProvider = {
  name: 'local',
  model: 'hash-256',
  dimensions: DIMENSIONS,

  async embed(ctx, text) {
    void ctx
    return { vector: hashEmbed(text), tokenCount: text.split(/\s+/).length }
  },

  async embedBatch(ctx, texts) {
    void ctx
    const vectors = texts.map((t) => hashEmbed(t))
    return { vectors, tokenCount: texts.reduce((s, t) => s + t.split(/\s+/).length, 0) }
  },
}
