// =============================================================================
// AI Visibility Service (Section 32) — REAL external observations
// =============================================================================
// Two modes:
//   REAL_EXTERNAL — uses WebSearchProvider to make actual HTTP requests
//                   to real search engines and web pages
//   SIMULATED     — uses LLM to simulate AI system responses (fallback only)
//
// The UI and APIs NEVER blur this distinction. Every observation records
// sourceType: 'real_external' or 'simulated'.
// Only real observations can become external-market evidence.

import type { TenantContext } from '../../tenant-context'
import type { LLMProvider } from '../../application/ports'
import { t } from '../../tenant-guard'
import { WebSearchAIVisibilityProvider, type RealAIObservation } from '../../infrastructure/ai-visibility/WebSearchProvider'
import { emit } from '../../event-bus'
import { randomUUID } from 'node:crypto'

export interface AIVisibilityObservation {
  id: string
  tenantId: string
  brand: string
  query: string
  sourceType: 'real_external' | 'simulated' // NEVER blurred
  provider: string // 'web_search' for real, 'llm:zai' for simulated
  brandMentioned: boolean
  mentionPositions: Array<{ url: string; position: number; context: string }>
  competitorMentions: Array<{ name: string; url: string; count: number }>
  attributes: string[]
  sourceUrls: string[]
  responseHash: string
  retrievedAt: Date
  provenance: string
  confidence: number
  // For real observations: the actual search results + page content
  searchResults?: Array<{ title: string; url: string; snippet: string; position: number }>
  pagesReadCount?: number
}

export interface AIVisibilityReport {
  brand: string
  totalObservations: number
  realObservations: number
  simulatedObservations: number
  mentionRate: number
  avgPosition: number | null
  competitorShare: Array<{ competitor: string; mentionCount: number; share: number }>
  topAttributes: string[]
  sourceBreakdown: { real_external: number; simulated: number }
  recommendations: string[]
}

export interface AIVisibilityService {
  /** Observe AI visibility using REAL web search (Level-3). */
  observeReal(ctx: TenantContext, input: {
    brand: string
    query: string
    competitors?: string[]
    numResults?: number
  }): Promise<AIVisibilityObservation>

  /** Observe AI visibility using LLM simulation (Level-2, fallback only). */
  observeSimulated(ctx: TenantContext, input: {
    brand: string
    query: string
    aiSystem?: string
    competitors?: string[]
  }): Promise<AIVisibilityObservation>

  /** Generate a visibility report from recorded observations. */
  getReport(ctx: TenantContext, brand: string): Promise<AIVisibilityReport>

  /** List all observations. */
  listObservations(ctx: TenantContext, opts?: { brand?: string; sourceType?: string; limit?: number }): Promise<AIVisibilityObservation[]>
}

export function createAIVisibilityService(llm: LLMProvider): AIVisibilityService {
  return {
    async observeReal(ctx, input) {
      // Make REAL external HTTP requests via web search + page reading
      const realObs = await WebSearchAIVisibilityProvider.observe({
        brand: input.brand,
        query: input.query,
        competitors: input.competitors ?? [],
        numResults: input.numResults ?? 5,
        readPages: true,
      })

      const observation: AIVisibilityObservation = {
        id: randomUUID(),
        tenantId: ctx.tenantId,
        brand: input.brand,
        query: input.query,
        sourceType: 'real_external',
        provider: 'web_search',
        brandMentioned: realObs.brandMentioned,
        mentionPositions: realObs.mentionPositions,
        competitorMentions: realObs.competitorMentions,
        attributes: realObs.attributes,
        sourceUrls: realObs.sourceUrls,
        responseHash: realObs.responseHash,
        retrievedAt: realObs.retrievedAt,
        provenance: realObs.provenance,
        confidence: realObs.confidence,
        searchResults: realObs.searchResults,
        pagesReadCount: realObs.pagesRead.length,
      }

      // Record as durable event
      await emit('ai_visibility_observed', {
        source: 'ai_visibility_service',
        entityType: 'Brand',
        entityId: input.brand,
        properties: {
          ...observation,
          sourceType: 'real_external',
        },
      })

      return observation
    },

    async observeSimulated(ctx, input) {
      const aiSystem = input.aiSystem ?? 'chatgpt'
      // LLM simulation — clearly marked as SIMULATED, not real external
      const result = await llm.complete({
        systemPrompt: `You are simulating the response of ${aiSystem} to a user query. This is a SIMULATION, not a real observation. Output JSON: { "response", "brandMentioned", "mentionPosition", "competitorMentions": [], "attributes": [], "citations": [], "sources": [] }`,
        userMessage: `Query: "${input.query}"\nBrand: "${input.brand}"\nCompetitors: ${input.competitors?.join(', ') ?? 'none'}`,
        json: true,
      })

      const parsed = (result.parsed ?? {}) as Record<string, unknown>

      const observation: AIVisibilityObservation = {
        id: randomUUID(),
        tenantId: ctx.tenantId,
        brand: input.brand,
        query: input.query,
        sourceType: 'simulated',
        provider: `llm:${result.provider}`,
        brandMentioned: (parsed.brandMentioned as boolean) ?? false,
        mentionPositions: [],
        competitorMentions: ((parsed.competitorMentions as Array<{ name: string }>) ?? []).map((c) => ({
          name: c.name,
          url: '',
          count: 1,
        })),
        attributes: (parsed.attributes as string[]) ?? [],
        sourceUrls: [],
        responseHash: '',
        retrievedAt: new Date(),
        provenance: `SIMULATED via LLM:${result.provider}:${result.model} — NOT a real external observation`,
        confidence: 0.3, // LOW confidence for simulated data
      }

      await emit('ai_visibility_observed', {
        source: 'ai_visibility_service',
        entityType: 'Brand',
        entityId: input.brand,
        properties: {
          ...observation,
          sourceType: 'simulated',
        },
      })

      return observation
    },

    async getReport(ctx, brand) {
      const events = await t.event.findMany({
        where: { eventType: 'ai_visibility_observed' },
        take: 500,
      })

      const observations = events
        .map((e) => JSON.parse(e.payload) as Record<string, unknown>)
        .filter((p) => p.brand === brand)

      const totalObservations = observations.length
      const realObs = observations.filter((o) => o.sourceType === 'real_external')
      const simulatedObs = observations.filter((o) => o.sourceType === 'simulated')

      const mentioned = observations.filter((o) => o.brandMentioned === true)
      const mentionRate = totalObservations > 0 ? mentioned.length / totalObservations : 0

      // Calculate position from real observations only
      const positions = realObs
        .flatMap((o) => (o.mentionPositions as Array<{ position: number }>) ?? [])
        .map((m) => m.position)
      const avgPosition = positions.length > 0
        ? positions.reduce((s, p) => s + p, 0) / positions.length
        : null

      // Competitor share (from real observations only)
      const competitorCounts = new Map<string, number>()
      for (const o of realObs) {
        for (const c of (o.competitorMentions as Array<{ name: string; count: number }>) ?? []) {
          competitorCounts.set(c.name, (competitorCounts.get(c.name) ?? 0) + c.count)
        }
      }
      const competitorShare = Array.from(competitorCounts.entries())
        .map(([name, count]) => ({
          competitor: name,
          mentionCount: count,
          share: realObs.length > 0 ? count / realObs.length : 0,
        }))
        .sort((a, b) => b.mentionCount - a.mentionCount)

      // Top attributes (from real observations only)
      const attrCounts = new Map<string, number>()
      for (const o of realObs) {
        for (const a of (o.attributes as string[]) ?? []) {
          attrCounts.set(a, (attrCounts.get(a) ?? 0) + 1)
        }
      }
      const topAttributes = Array.from(attrCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([a]) => a)

      const recommendations: string[] = []
      if (totalObservations === 0) {
        recommendations.push('No observations yet. Run a real observation to start tracking AI visibility.')
      }
      if (realObs.length === 0 && totalObservations > 0) {
        recommendations.push('All observations are SIMULATED. Run real observations for trustworthy AI visibility data.')
      }
      if (mentionRate < 0.3 && totalObservations > 0) {
        recommendations.push(`Brand mention rate is ${(mentionRate * 100).toFixed(0)}% — below 30% threshold.`)
      }
      if (recommendations.length === 0) {
        recommendations.push('AI visibility tracking is active with real observations.')
      }

      return {
        brand,
        totalObservations,
        realObservations: realObs.length,
        simulatedObservations: simulatedObs.length,
        mentionRate,
        avgPosition,
        competitorShare,
        topAttributes,
        sourceBreakdown: {
          real_external: realObs.length,
          simulated: simulatedObs.length,
        },
        recommendations,
      }
    },

    async listObservations(ctx, opts) {
      const events = await t.event.findMany({
        where: { eventType: 'ai_visibility_observed' },
        orderBy: { occurredAt: 'desc' },
        take: opts?.limit ?? 50,
      })
      return events.map((e) => {
        const p = JSON.parse(e.payload) as Record<string, unknown>
        return {
          id: e.id,
          tenantId: ctx.tenantId,
          brand: p.brand as string,
          query: p.query as string,
          sourceType: p.sourceType as 'real_external' | 'simulated',
          provider: p.provider as string,
          brandMentioned: p.brandMentioned as boolean,
          mentionPositions: (p.mentionPositions as Array<{ url: string; position: number; context: string }>) ?? [],
          competitorMentions: (p.competitorMentions as Array<{ name: string; url: string; count: number }>) ?? [],
          attributes: (p.attributes as string[]) ?? [],
          sourceUrls: (p.sourceUrls as string[]) ?? [],
          responseHash: p.responseHash as string,
          retrievedAt: e.occurredAt,
          provenance: p.provenance as string,
          confidence: p.confidence as number,
        }
      })
    },
  }
}
