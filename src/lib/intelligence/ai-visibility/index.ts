// =============================================================================
// AI Visibility Subsystem (Section 32) — REAL service, not an interface
// =============================================================================
// Tracks brand mentions in AI systems (ChatGPT, Perplexity, Gemini, etc.),
// AI share of voice, competitive position.
//
// Model: Brand → Query → AI System → Response → Mention → Position → Citation → Competitor
//
// Uses the LLMProvider to simulate AI system responses (in production, this
// would call the actual AI APIs). All observations have provenance.
//
// Eventually connects: AI visibility → intervention → experiment → causal measurement

import type { TenantContext } from '../../tenant-context'
import type { LLMProvider } from '../../application/ports'
import { t } from '../../tenant-guard'
import { randomUUID } from 'node:crypto'

export interface AIVisibilityObservation {
  id: string
  tenantId: string
  brand: string
  query: string
  aiSystem: string // chatgpt | perplexity | gemini | claude
  response: string
  brandMentioned: boolean
  mentionPosition: number | null // position in response (1 = first mention)
  competitorMentions: Array<{ name: string; position: number }>
  attributes: string[] // what attributes are associated with the brand
  citations: string[]
  sources: string[]
  confidence: number
  retrievedAt: Date
  provenance: string
}

export interface AIVisibilityReport {
  brand: string
  totalQueries: number
  mentionRate: number // % of queries where brand was mentioned
  avgPosition: number | null
  competitorShare: Array<{ competitor: string; mentionCount: number; share: number }>
  topAttributes: string[]
  recommendations: string[]
}

export interface AIVisibilityService {
  /** Query an AI system about a brand/category and record the observation. */
  observe(ctx: TenantContext, input: {
    brand: string
    query: string
    aiSystem?: string
    competitors?: string[]
  }): Promise<AIVisibilityObservation>

  /** Generate a visibility report for a brand. */
  getReport(ctx: TenantContext, brand: string): Promise<AIVisibilityReport>

  /** List all observations for the tenant. */
  listObservations(ctx: TenantContext, opts?: { brand?: string; limit?: number }): Promise<AIVisibilityObservation[]>
}

export function createAIVisibilityService(llm: LLMProvider): AIVisibilityService {
  return {
    async observe(ctx, input) {
      const aiSystem = input.aiSystem ?? 'chatgpt'
      const competitors = input.competitors ?? []

      // Use the LLM to simulate what an AI system would say in response to the query.
      // In production, this would call the actual AI API (OpenAI, Anthropic, etc.)
      // and parse the response for brand mentions.
      const result = await llm.complete({
        systemPrompt: `You are simulating the response of ${aiSystem} to a user query. Respond as ${aiSystem} would — helpful, informative, citing sources where appropriate. If the query is about a product/service category, mention relevant brands including "${input.brand}" and these competitors: ${competitors.join(', ')}. Be realistic — don't always mention the brand.

Output JSON: {
  "response": "the full text response",
  "brandMentioned": true/false,
  "mentionPosition": null or number (1 = first mention),
  "competitorMentions": [{ "name": "...", "position": 1 }],
  "attributes": ["what attributes are associated with the brand"],
  "citations": ["sources cited"],
  "sources": ["source URLs or names"]
}`,
        userMessage: `Query: "${input.query}"
Brand: "${input.brand}"
Competitors: ${competitors.join(', ') || 'none specified'}`,
        json: true,
      })

      const parsed = (result.parsed ?? {}) as Partial<AIVisibilityObservation>

      const observation: AIVisibilityObservation = {
        id: randomUUID(),
        tenantId: ctx.tenantId,
        brand: input.brand,
        query: input.query,
        aiSystem,
        response: parsed.response ?? '',
        brandMentioned: parsed.brandMentioned ?? false,
        mentionPosition: parsed.mentionPosition ?? null,
        competitorMentions: parsed.competitorMentions ?? [],
        attributes: parsed.attributes ?? [],
        citations: parsed.citations ?? [],
        sources: parsed.sources ?? [],
        confidence: result.fellBack ? 0.4 : 0.7,
        retrievedAt: new Date(),
        provenance: `LLM:${result.provider}:${result.model} (simulated ${aiSystem})`,
      }

      // Record the observation as an event (REAL — durable, replayable)
      const { emit } = await import('../../event-bus')
      await emit('ai_visibility_observed', {
        source: 'ai_visibility_service',
        entityType: 'Brand',
        entityId: input.brand,
        properties: {
          brand: input.brand,
          query: input.query,
          aiSystem,
          brandMentioned: observation.brandMentioned,
          mentionPosition: observation.mentionPosition,
          competitorMentions: observation.competitorMentions,
          attributes: observation.attributes,
        },
      })

      return observation
    },

    async getReport(ctx, brand) {
      // Get all observations for this brand from the event log
      const events = await t.event.findMany({
        where: { eventType: 'ai_visibility_observed' },
        take: 500,
      })

      const observations = events
        .map((e) => JSON.parse(e.payload) as Record<string, unknown>)
        .filter((p) => p.brand === brand)

      const totalQueries = observations.length
      const mentioned = observations.filter((o) => o.brandMentioned === true)
      const mentionRate = totalQueries > 0 ? mentioned.length / totalQueries : 0

      const positions = mentioned
        .map((o) => o.mentionPosition as number)
        .filter((p): p is number => p !== null && p !== undefined)
      const avgPosition = positions.length > 0
        ? positions.reduce((s, p) => s + p, 0) / positions.length
        : null

      // Competitor share
      const competitorCounts = new Map<string, number>()
      for (const o of observations) {
        const comps = (o.competitorMentions ?? []) as Array<{ name: string }>
        for (const c of comps) {
          competitorCounts.set(c.name, (competitorCounts.get(c.name) ?? 0) + 1)
        }
      }
      const competitorShare = Array.from(competitorCounts.entries())
        .map(([name, count]) => ({
          competitor: name,
          mentionCount: count,
          share: totalQueries > 0 ? count / totalQueries : 0,
        }))
        .sort((a, b) => b.mentionCount - a.mentionCount)

      // Top attributes
      const attrCounts = new Map<string, number>()
      for (const o of observations) {
        for (const a of (o.attributes ?? []) as string[]) {
          attrCounts.set(a, (attrCounts.get(a) ?? 0) + 1)
        }
      }
      const topAttributes = Array.from(attrCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([a]) => a)

      // Recommendations
      const recommendations: string[] = []
      if (mentionRate < 0.3) {
        recommendations.push(`Brand mention rate is ${(mentionRate * 100).toFixed(0)}% — below 30% threshold. Focus on content that AI systems cite.`)
      }
      if (avgPosition && avgPosition > 3) {
        recommendations.push(`Average mention position is ${avgPosition.toFixed(1)} — competitors are mentioned first. Strengthen brand authority signals.`)
      }
      if (recommendations.length === 0) {
        recommendations.push('AI visibility is healthy. Continue monitoring for changes.')
      }

      return {
        brand,
        totalQueries,
        mentionRate,
        avgPosition,
        competitorShare,
        topAttributes,
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
          aiSystem: p.aiSystem as string,
          response: '', // not stored in event — fetch from observation store
          brandMentioned: p.brandMentioned as boolean,
          mentionPosition: p.mentionPosition as number | null,
          competitorMentions: p.competitorMentions as Array<{ name: string; position: number }>,
          attributes: p.attributes as string[],
          citations: [],
          sources: [],
          confidence: 0.7,
          retrievedAt: e.occurredAt,
          provenance: 'ai_visibility_service',
        }
      })
    },
  }
}
