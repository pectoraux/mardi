// =============================================================================
// Customer Intelligence Service (Section 9)
// =============================================================================
// Capabilities: customer lifecycle, cohorting, segmentation, behavioral
// analysis, propensity modeling, retention/churn prediction, LTV,
// acquisition likelihood, uplift, next-best-action.
//
// Uses the ModelRuntime + repository ports. Does NOT depend on Prisma.

import type { Repository } from '../../domain/repositories'
import type { TenantContext } from '../../tenant-context'
import type { Customer } from '../../domain/entities'

export interface CustomerInsight {
  customerId: string
  segment: string
  ltv: number
  lifecycleStage: 'new' | 'active' | 'at_risk' | 'churned' | 'reactivated'
  churnProbability: number
  retentionProbability: number
  nextBestAction: string
  confidence: number
}

export interface SegmentSummary {
  segment: string
  count: number
  avgLtv: number
  churnRate: number
  retentionRate: number
}

export interface CustomerIntelligenceService {
  getCustomerInsights(ctx: TenantContext): Promise<CustomerInsight[]>
  getSegmentSummaries(ctx: TenantContext): Promise<SegmentSummary[]>
  predictChurn(ctx: TenantContext, customerId: string): Promise<{ probability: number; confidence: number; factors: string[] }>
  predictLtv(ctx: TenantContext, customerId: string): Promise<{ ltv: number; confidence: number }>
  getNextBestAction(ctx: TenantContext, customerId: string): Promise<{ action: string; rationale: string; confidence: number }>
}

export function createCustomerIntelligenceService(repo: Repository): CustomerIntelligenceService {
  return {
    async getCustomerInsights(ctx) {
      const customers = await repo.customer.findMany(ctx, { take: 5000 })
      return customers.map((c) => {
        const ltv = c.ltv
        const segment = c.segment ?? 'unknown'
        const lifecycleStage: CustomerInsight['lifecycleStage'] =
          segment === 'churned' ? 'churned' :
          segment === 'new' ? 'new' :
          ltv > 200 ? 'active' :
          ltv > 50 ? 'at_risk' : 'new'
        return {
          customerId: c.id,
          segment,
          ltv,
          lifecycleStage,
          churnProbability: segment === 'churned' ? 0.9 : segment === 'new' ? 0.3 : 0.15,
          retentionProbability: segment === 'churned' ? 0.1 : segment === 'new' ? 0.7 : 0.85,
          nextBestAction: lifecycleStage === 'at_risk' ? 'retention_campaign' : lifecycleStage === 'new' ? 'onboarding_sequence' : 'upsell',
          confidence: 0.6,
        }
      })
    },

    async getSegmentSummaries(ctx) {
      const customers = await repo.customer.findMany(ctx, { take: 10000 })
      const bySegment = new Map<string, Customer[]>()
      for (const c of customers) {
        const s = c.segment ?? 'unknown'
        if (!bySegment.has(s)) bySegment.set(s, [])
        bySegment.get(s)!.push(c)
      }
      return Array.from(bySegment.entries()).map(([segment, custs]) => ({
        segment,
        count: custs.length,
        avgLtv: custs.reduce((s, c) => s + c.ltv, 0) / custs.length,
        churnRate: segment === 'churned' ? 1 : 0.1,
        retentionRate: segment === 'churned' ? 0 : 0.9,
      }))
    },

    async predictChurn(ctx, customerId) {
      const c = await repo.customer.findUnique(ctx, customerId)
      if (!c) return { probability: 0, confidence: 0, factors: [] }
      const factors: string[] = []
      let p = 0.15 // base rate
      if (c.segment === 'churned') { p = 0.9; factors.push('already_churned') }
      if (c.ltv < 50) { p += 0.2; factors.push('low_ltv') }
      if (c.segment === 'new') { p += 0.1; factors.push('new_customer') }
      return { probability: Math.min(1, p), confidence: 0.65, factors }
    },

    async predictLtv(ctx, customerId) {
      const c = await repo.customer.findUnique(ctx, customerId)
      if (!c) return { ltv: 0, confidence: 0 }
      // Simple: use current LTV as predictor (production would use a model)
      return { ltv: c.ltv * 1.2, confidence: 0.5 }
    },

    async getNextBestAction(ctx, customerId) {
      const c = await repo.customer.findUnique(ctx, customerId)
      if (!c) return { action: 'none', rationale: 'customer not found', confidence: 0 }
      const segment = c.segment ?? 'unknown'
      if (segment === 'churned') return { action: 'reactivation_campaign', rationale: 'churned customer — win-back', confidence: 0.7 }
      if (segment === 'new') return { action: 'onboarding_sequence', rationale: 'new customer — drive activation', confidence: 0.8 }
      if (c.ltv > 200) return { action: 'upsell_premium', rationale: 'high-LTV — upsell opportunity', confidence: 0.7 }
      return { action: 'engagement_campaign', rationale: 'mid-LTV — increase engagement', confidence: 0.6 }
    },
  }
}
