// =============================================================================
// Opportunity Engine (Section 17)
// =============================================================================
// Detects opportunities across: market, customer, creative, channel, budget,
// conversion, retention, pricing, AI visibility, competitive dynamics.
//
// Every opportunity includes: size, expected value, confidence, evidence,
// uncertainty, urgency, cost to test, recommended next experiment.

import type { Repository } from '../../domain/repositories'
import type { TenantContext } from '../../tenant-context'
import type { CausalEnginePort } from '../../application/ports'

export interface Opportunity {
  type: 'scale' | 'pause' | 'shift_budget' | 'experiment' | 'creative_refresh' | 'retention' | 'pricing' | 'ai_visibility' | 'competitive'
  scope: string
  description: string
  size: 'small' | 'medium' | 'large'
  expectedValue: number
  confidence: number
  uncertainty: { low: number; high: number }
  urgency: 'low' | 'medium' | 'high'
  costToTest: number
  evidence: Array<{ type: string; id: string; summary: string }>
  recommendedNextExperiment: string
}

export interface OpportunityEngine {
  detect(ctx: TenantContext): Promise<Opportunity[]>
}

export function createOpportunityEngine(repo: Repository, causalEngine: CausalEnginePort): OpportunityEngine {
  return {
    async detect(ctx) {
      const [campaigns, customers, experiments, causalEstimates] = await Promise.all([
        repo.campaign.findMany(ctx, {}),
        repo.customer.findMany(ctx, { take: 5000 }),
        repo.experiment.findMany(ctx, {}),
        repo.causalEstimate.findMany(ctx, {}),
      ])

      const opportunities: Opportunity[] = []

      // Campaign opportunities (from causal estimates)
      const byCampaign = new Map<string, typeof causalEstimates>()
      for (const ce of causalEstimates) {
        const key = ce.campaignId ?? '_none'
        if (!byCampaign.has(key)) byCampaign.set(key, [])
        byCampaign.get(key)!.push(ce)
      }

      for (const [campId, estimates] of byCampaign) {
        const best = estimates.sort((a, b) => b.confidence - a.confidence)[0]
        if (best.effectSizePct > 0.1 && best.confidence >= 0.6) {
          const camp = campaigns.find((c) => c.id === campId)
          opportunities.push({
            type: 'scale',
            scope: camp?.name ?? campId,
            description: `Scale "${camp?.name ?? campId}" — causal lift +${(best.effectSizePct * 100).toFixed(1)}% (${best.methodology})`,
            size: best.effectSizePct > 0.2 ? 'large' : 'medium',
            expectedValue: (camp?.spent ?? 0) * best.effectSizePct,
            confidence: best.confidence,
            uncertainty: { low: best.uncertaintyLow, high: best.uncertaintyHigh },
            urgency: best.confidence > 0.8 ? 'high' : 'medium',
            costToTest: 0,
            evidence: [{ type: 'CausalEstimate', id: best.id, summary: `${best.methodology}: +${(best.effectSizePct * 100).toFixed(1)}%` }],
            recommendedNextExperiment: `Holdout on next +20% budget increment`,
          })
        }
        if (best.effectSizePct <= 0 && best.confidence >= 0.6) {
          opportunities.push({
            type: 'pause',
            scope: camp?.name ?? campId,
            description: `Pause "${camp?.name ?? campId}" — no measurable incremental lift`,
            size: 'medium',
            expectedValue: (camp?.spent ?? 0) * 0.4,
            confidence: best.confidence,
            uncertainty: { low: best.uncertaintyLow, high: best.uncertaintyHigh },
            urgency: 'medium',
            costToTest: 0,
            evidence: [{ type: 'CausalEstimate', id: best.id, summary: `${best.methodology}: ${(best.effectSizePct * 100).toFixed(1)}%` }],
            recommendedNextExperiment: 'Geo holdout to confirm incrementality',
          })
        }
      }

      // Customer opportunities (retention)
      const churnedCount = customers.filter((c) => c.segment === 'churned').length
      if (churnedCount > 0) {
        opportunities.push({
          type: 'retention',
          scope: 'churned_customers',
          description: `${churnedCount} churned customers — reactivation campaign opportunity`,
          size: churnedCount > 50 ? 'large' : 'medium',
          expectedValue: churnedCount * 30, // estimated reactivation value
          confidence: 0.5,
          uncertainty: { low: 0, high: churnedCount * 50 },
          urgency: 'medium',
          costToTest: 0,
          evidence: [{ type: 'CustomerSegment', id: 'churned', summary: `${churnedCount} churned customers` }],
          recommendedNextExperiment: 'A/B test reactivation incentive vs control',
        })
      }

      // Always propose at least one experiment opportunity
      if (opportunities.length === 0) {
        opportunities.push({
          type: 'experiment',
          scope: 'incrementality',
          description: 'Run an incrementality holdout on the largest-spend campaign',
          size: 'medium',
          expectedValue: 0,
          confidence: 0.4,
          uncertainty: { low: 0, high: 0 },
          urgency: 'low',
          costToTest: 0,
          evidence: [],
          recommendedNextExperiment: 'Randomized geo holdout with 20% holdout markets',
        })
      }

      return opportunities.sort((a, b) => b.expectedValue * b.confidence - a.expectedValue * a.confidence)
    },
  }
}
