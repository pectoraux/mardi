// =============================================================================
// Market Intelligence Service (Section 10)
// =============================================================================
// Capabilities: market sizing, category dynamics, competitor monitoring,
// pricing, category entry points, brand presence, share of voice, search
// demand, AI visibility, public-source research, review intelligence.
//
// INVARIANT (Section 10): Do not invent market facts. All external
// observations require source, retrieval time, provenance, source type,
// confidence.

import type { TenantContext } from '../../tenant-context'
import type { LLMProvider } from '../../application/ports'

export interface MarketObservation {
  type: string
  value: string
  source: string
  sourceType: 'public_web' | 'search' | 'social' | 'review' | 'news' | 'ai_system'
  retrievedAt: Date
  confidence: number
  provenance: string
}

export interface MarketIntelligenceReport {
  market: string
  observations: MarketObservation[]
  competitors: Array<{ name: string; url?: string; positioning?: string; confidence: number }>
  categoryEntryPoints: string[]
  trends: string[]
  uncertainty: string
}

export interface MarketIntelligenceService {
  researchMarket(ctx: TenantContext, market: string): Promise<MarketIntelligenceReport>
  monitorCompetitor(ctx: TenantContext, competitorName: string): Promise<MarketObservation[]>
  getCategoryEntryPoints(ctx: TenantContext, category: string): Promise<string[]>
}

export function createMarketIntelligenceService(llm: LLMProvider): MarketIntelligenceService {
  return {
    async researchMarket(ctx, market) {
      const result = await llm.complete({
        systemPrompt: `You are a Market Intelligence agent. Research the market "${market}" using only publicly available information. 

ABSOLUTE RULES:
1. Do NOT invent market facts. If you don't know, say "not available from public sources."
2. Every observation must have a source and confidence level.
3. Clearly distinguish OBSERVED (public signals) from INFERRED.

Output JSON: { "observations": [{ "type", "value", "source", "sourceType", "confidence" }], "competitors": [{ "name", "url", "positioning", "confidence" }], "categoryEntryPoints": ["..."], "trends": ["..."], "uncertainty": "..." }`,
        userMessage: `Research market: ${market}`,
        json: true,
      })

      const parsed = (result.parsed ?? {}) as Partial<MarketIntelligenceReport>
      return {
        market,
        observations: (parsed.observations ?? []).map((o) => ({
          ...o,
          retrievedAt: new Date(),
          provenance: `LLM:${result.provider}:${result.model}`,
        })) as MarketObservation[],
        competitors: parsed.competitors ?? [],
        categoryEntryPoints: parsed.categoryEntryPoints ?? [],
        trends: parsed.trends ?? [],
        uncertainty: parsed.uncertainty ?? 'Unable to determine — LLM response parsing incomplete.',
      }
    },

    async monitorCompetitor(ctx, competitorName) {
      void ctx
      const result = await llm.complete({
        systemPrompt: `Monitor competitor "${competitorName}" using only public information. Output JSON: { "observations": [{ "type", "value", "source", "sourceType", "confidence" }] }`,
        userMessage: `Monitor: ${competitorName}`,
        json: true,
      })
      const parsed = (result.parsed ?? {}) as { observations?: MarketObservation[] }
      return (parsed.observations ?? []).map((o) => ({
        ...o,
        retrievedAt: new Date(),
        provenance: `LLM:${result.provider}:${result.model}`,
      })) as MarketObservation[]
    },

    async getCategoryEntryPoints(ctx, category) {
      void ctx
      const result = await llm.complete({
        systemPrompt: `List the top category entry points for "${category}". Output JSON: { "entryPoints": ["..."] }`,
        userMessage: `Category: ${category}`,
        json: true,
      })
      const parsed = (result.parsed ?? {}) as { entryPoints?: string[] }
      return parsed.entryPoints ?? []
    },
  }
}
