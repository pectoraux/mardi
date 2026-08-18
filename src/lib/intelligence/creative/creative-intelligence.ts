// =============================================================================
// Creative Intelligence Service (Section 11)
// =============================================================================
// Pipeline: asset → extraction → transcription → OCR → visual analysis →
// semantic analysis → embeddings → creative feature store → outcome linkage
// → experiment linkage → causal analysis.
//
// Creative features: hook, opening frame, message, promise, benefit, proof,
// emotional frame, CTA, brand presence, distinctive assets, category entry
// point, audience, duration, format, platform, visual structure, audio.
//
// Uses VLM (Vision Language Model) for visual analysis + LLM for narrative.

import type { TenantContext } from '../../tenant-context'
import type { LLMProvider, EmbeddingProvider } from '../../application/ports'
import type { Repository } from '../../domain/repositories'

export interface CreativeFeatures {
  hook?: string
  message?: string
  promise?: string
  benefit?: string
  proof?: string
  emotionalFrame?: string
  cta?: string
  brandPresence?: string
  distinctiveAssets?: string[]
  categoryEntryPoint?: string
  audience?: string
  format?: string
  platform?: string
  visualStructure?: string
  audioCharacteristics?: string
}

export interface CreativeAnalysis {
  creativeId: string
  features: CreativeFeatures
  embedding: number[]
  outcomeLinkage?: {
    experimentId?: string
    effectSizePct?: number
    confidence?: number
  }
}

export interface CreativeIntelligenceService {
  analyzeCreative(ctx: TenantContext, creativeId: string, content?: { text?: string; imageUrl?: string }): Promise<CreativeAnalysis>
  compareCreatives(ctx: TenantContext, creativeA: string, creativeB: string): Promise<{ similarity: number; differences: string[] }>
  clusterCreatives(ctx: TenantContext): Promise<Array<{ clusterId: string; creatives: string[]; centroid: string }>>
  recommendCreative(ctx: TenantContext, brief: string): Promise<{ recommendation: string; rationale: string; confidence: number }>
}

export function createCreativeIntelligenceService(
  llm: LLMProvider,
  embedding: EmbeddingProvider,
  repo: Repository,
): CreativeIntelligenceService {
  return {
    async analyzeCreative(ctx, creativeId, content) {
      const creative = await repo.creative.findUnique(ctx, creativeId)
      if (!creative) throw new Error('creative not found')

      // Extract features via LLM
      const featuresResult = await llm.complete({
        systemPrompt: `Analyze this marketing creative and extract its features. Output JSON: { "hook", "message", "promise", "benefit", "proof", "emotionalFrame", "cta", "brandPresence", "distinctiveAssets": [], "categoryEntryPoint", "audience", "format", "platform", "visualStructure", "audioCharacteristics" }`,
        userMessage: `Creative: ${creative.name}
Hook: ${creative.hook ?? 'N/A'}
Promise: ${creative.promise ?? 'N/A'}
CTA: ${creative.cta ?? 'N/A'}
Format: ${creative.format}
Channel: ${creative.channel ?? 'N/A'}
${content?.text ? `Text: ${content.text}` : ''}`,
        json: true,
      })

      const features = (featuresResult.parsed ?? {}) as CreativeFeatures
      const embeddingResult = await embedding.embed(ctx, `${creative.name} ${creative.hook ?? ''} ${creative.promise ?? ''} ${creative.cta ?? ''}`)

      return {
        creativeId,
        features,
        embedding: embeddingResult.vector,
      }
    },

    async compareCreatives(ctx, creativeA, creativeB) {
      const a = await repo.creative.findUnique(ctx, creativeA)
      const b = await repo.creative.findUnique(ctx, creativeB)
      if (!a || !b) throw new Error('creative not found')

      const embA = await embedding.embed(ctx, `${a.name} ${a.hook ?? ''} ${a.promise ?? ''}`)
      const embB = await embedding.embed(ctx, `${b.name} ${b.hook ?? ''} ${b.promise ?? ''}`)

      // Cosine similarity
      let dot = 0, magA = 0, magB = 0
      for (let i = 0; i < embA.vector.length; i++) {
        dot += embA.vector[i] * embB.vector[i]
        magA += embA.vector[i] ** 2
        magB += embB.vector[i] ** 2
      }
      const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB))

      const differences: string[] = []
      if (a.hook !== b.hook) differences.push(`hook: "${a.hook}" vs "${b.hook}"`)
      if (a.promise !== b.promise) differences.push(`promise: "${a.promise}" vs "${b.promise}"`)
      if (a.cta !== b.cta) differences.push(`cta: "${a.cta}" vs "${b.cta}"`)

      return { similarity, differences }
    },

    async clusterCreatives(ctx) {
      const creatives = await repo.creative.findMany(ctx, { take: 100 })
      // Simple clustering by channel + format (production: k-means on embeddings)
      const clusters = new Map<string, string[]>()
      for (const c of creatives) {
        const key = `${c.channel ?? 'unknown'}:${c.format}`
        if (!clusters.has(key)) clusters.set(key, [])
        clusters.get(key)!.push(c.id)
      }
      return Array.from(clusters.entries()).map(([key, ids], i) => ({
        clusterId: `cluster_${i}`,
        creatives: ids,
        centroid: key,
      }))
    },

    async recommendCreative(ctx, brief) {
      const result = await llm.complete({
        systemPrompt: `Given this creative brief, recommend the best creative approach. Output JSON: { "recommendation", "rationale", "confidence" }`,
        userMessage: `Brief: ${brief}`,
        json: true,
      })
      return (result.parsed ?? { recommendation: 'N/A', rationale: 'LLM parsing failed', confidence: 0 }) as { recommendation: string; rationale: string; confidence: number }
    },
  }
}
