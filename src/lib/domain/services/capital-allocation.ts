// =============================================================================
// Zero-Capital Growth Engine (hardening pass)
// =============================================================================
// When available capital = $0, the decision engine automatically prioritizes
// zero-capital channels:
//   organic content, SEO, free tools, outreach, partnerships,
//   referrals, community, product-led acquisition
//
// Once actual revenue exists:
//   revenue → available marketing capital → hypotheses → experiments
//           → measured return → reinvestment
//
// This turns the platform itself into its first customer. The internal
// tenant (MARDI_INTERNAL) uses this engine to acquire its first real
// customer for $0.

import type { Repository } from '../repositories'
import type { TenantContext } from '../../tenant-context'
import type { CapitalSummary } from '../entities'

export interface ZeroCapitalChannel {
  type: string
  label: string
  description: string
  expectedEffort: 'low' | 'medium' | 'high'
  expectedTimeToResult: string
  capitalRequired: number
  rationale: string
}

export const ZERO_CAPITAL_CHANNELS: ZeroCapitalChannel[] = [
  {
    type: 'organic_content',
    label: 'Organic Content',
    description: 'Publish research, case studies, and thought leadership that demonstrates the platform\'s intelligence.',
    expectedEffort: 'high',
    expectedTimeToResult: '60-90 days',
    capitalRequired: 0,
    rationale: 'Content is the zero-capital acquisition channel with the highest compounding return. The platform itself generates insights worth publishing.',
  },
  {
    type: 'seo',
    label: 'SEO',
    description: 'Target intent-driven queries the platform can answer better than any existing tool.',
    expectedEffort: 'medium',
    expectedTimeToResult: '90-120 days',
    capitalRequired: 0,
    rationale: 'Decision-intelligence queries have low competition and high commercial intent. The platform\'s evidence graph produces content no competitor can match.',
  },
  {
    type: 'free_tools',
    label: 'Free Tools',
    description: 'Ship a free, lightweight version of the decision engine (e.g. "causal lift calculator") as a lead magnet.',
    expectedEffort: 'medium',
    expectedTimeToResult: '30-60 days',
    capitalRequired: 0,
    rationale: 'A free tool demonstrates the platform\'s core value (causal reasoning) and captures high-intent leads. Product-led acquisition.',
  },
  {
    type: 'outreach',
    label: 'Outreach',
    description: 'Identify 50 marketing leaders whose companies would benefit. Personalized, evidence-backed outreach.',
    expectedEffort: 'medium',
    expectedTimeToResult: '14-30 days',
    capitalRequired: 0,
    rationale: 'The platform can identify prospects by analyzing public marketing data. Each outreach references specific evidence the platform found about their business.',
  },
  {
    type: 'partnerships',
    label: 'Partnerships',
    description: 'Partner with marketing agencies and consultancies who could resell or refer the platform.',
    expectedEffort: 'medium',
    expectedTimeToResult: '60-90 days',
    capitalRequired: 0,
    rationale: 'Agencies have existing client relationships and a direct incentive to recommend a tool that improves client outcomes.',
  },
  {
    type: 'referrals',
    label: 'Referrals',
    description: 'Build a referral program. Every user who gets value can refer others.',
    expectedEffort: 'low',
    expectedTimeToResult: '30-60 days',
    capitalRequired: 0,
    rationale: 'Referrals have the lowest CAC and highest conversion rate. The platform tracks who referred whom in the evidence graph.',
  },
  {
    type: 'community',
    label: 'Community',
    description: 'Build a community of marketing decision-makers around evidence-based marketing.',
    expectedEffort: 'high',
    expectedTimeToResult: '90-180 days',
    capitalRequired: 0,
    rationale: 'A community compounds: it becomes a source of prospects, case studies, and product feedback. The platform\'s decision ledger becomes shared knowledge.',
  },
  {
    type: 'product_led',
    label: 'Product-Led Acquisition',
    description: 'Make the platform self-serve. The product itself is the acquisition channel.',
    expectedEffort: 'high',
    expectedTimeToResult: '60-90 days',
    capitalRequired: 0,
    rationale: 'When the product demonstrates value in the first session, it acquires users without sales or marketing spend. The demo accounts are the PLG entry point.',
  },
]

export interface CapitalAllocationService {
  getCapitalSummary(ctx: TenantContext): Promise<CapitalSummary>
  recordCapital(ctx: TenantContext, entry: {
    type: 'AVAILABLE' | 'COMMITTED' | 'SPENT' | 'EXPECTED_RETURN' | 'REALIZED_RETURN' | 'REINVESTMENT'
    amount: number
    source: string
    referenceType?: string
    referenceId?: string
    description?: string
  }): Promise<void>
  /** When capital = $0, returns the zero-capital channel recommendations. */
  getZeroCapitalStrategy(ctx: TenantContext): Promise<{
    summary: CapitalSummary
    isZeroCapital: boolean
    channels: ZeroCapitalChannel[]
    rationale: string
  }>
}

export function createCapitalAllocationService(repo: Repository): CapitalAllocationService {
  return {
    async getCapitalSummary(ctx) {
      return repo.capitalLedger.getSummary(ctx)
    },

    async recordCapital(ctx, entry) {
      await repo.capitalLedger.create(ctx, {
        type: entry.type,
        amount: entry.amount,
        source: entry.source,
        referenceType: entry.referenceType ?? null,
        referenceId: entry.referenceId ?? null,
        description: entry.description ?? null,
      })
    },

    async getZeroCapitalStrategy(ctx) {
      const summary = await repo.capitalLedger.getSummary(ctx)
      const isZeroCapital = summary.available <= 0
      return {
        summary,
        isZeroCapital,
        channels: isZeroCapital ? ZERO_CAPITAL_CHANNELS : [],
        rationale: isZeroCapital
          ? 'Available capital is $0. The decision engine prioritizes zero-capital acquisition channels. Once revenue is realized, it flows into the reinvestment pool and paid channels become available.'
          : `Available capital is $${summary.available.toFixed(2)}. Paid channels are available. The decision engine will allocate capital to the highest-expected-incremental-return opportunities first.`,
      }
    },
  }
}
