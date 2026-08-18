// =============================================================================
// Capital Provenance Service (milestone 1)
// =============================================================================
// INVARIANT: synthetic/test capital can NEVER authorize real-world spending.
// The system distinguishes:
//   SYNTHETIC / TEST      — demo/seed capital, cannot authorize paid execution
//   OWNER_FUNDED          — real money the operator put in
//   EARNED_REVENUE        — real revenue from real customers
//   REINVESTED_PROFIT     — profit reinvested into marketing
//
// Only OWNER_FUNDED + EARNED_REVENUE + REINVESTED_PROFIT count toward
// "verified available capital." SYNTHETIC is tracked separately and
// explicitly excluded from spending authorization.

import type { Repository } from '../repositories'
import type { TenantContext } from '../../tenant-context'
import type { CapitalSummary } from '../entities'

export type CapitalProvenance = 'SYNTHETIC' | 'OWNER_FUNDED' | 'EARNED_REVENUE' | 'REINVESTED_PROFIT'
export type VerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED'

export interface TrustworthyCapitalSummary extends CapitalSummary {
  // Breakdown by provenance
  synthetic: number
  ownerFunded: number
  earnedRevenue: number
  reinvestedProfit: number
  // What can actually authorize spending
  verifiedAvailable: number
  // What cannot
  syntheticAvailable: number
}

export interface CapitalProvenanceService {
  recordCapital(ctx: TenantContext, entry: {
    type: 'AVAILABLE' | 'COMMITTED' | 'SPENT' | 'EXPECTED_RETURN' | 'REALIZED_RETURN' | 'REINVESTMENT'
    amount: number
    source: string
    provenance: CapitalProvenance
    verificationStatus?: VerificationStatus
    referenceType?: string
    referenceId?: string
    description?: string
    verifiedBy?: string
  }): Promise<void>

  getTrustworthySummary(ctx: TenantContext): Promise<TrustworthyCapitalSummary>

  /** Returns true ONLY if the tenant has verified (non-synthetic) capital
   *  available to cover the proposed cash cost. */
  canAuthorizeSpend(ctx: TenantContext, amount: number): Promise<boolean>

  /** Records real revenue with EARNED_REVENUE provenance + VERIFIED status. */
  recordEarnedRevenue(ctx: TenantContext, entry: {
    amount: number
    source: string // payment_provider | invoice | manual_verification
    referenceType?: string
    referenceId?: string
    description?: string
    verifiedBy: string
  }): Promise<void>
}

export function createCapitalProvenanceService(repo: Repository): CapitalProvenanceService {
  return {
    async recordCapital(ctx, entry) {
      await repo.capitalLedger.create(ctx, {
        type: entry.type,
        amount: entry.amount,
        source: entry.source,
        provenance: entry.provenance,
        verificationStatus: entry.verificationStatus ?? (entry.provenance === 'SYNTHETIC' ? 'UNVERIFIED' : 'VERIFIED'),
        verifiedAt: entry.verificationStatus === 'VERIFIED' || (entry.provenance !== 'SYNTHETIC' && !entry.verificationStatus) ? new Date() : null,
        verifiedBy: entry.verifiedBy ?? null,
        referenceType: entry.referenceType ?? null,
        referenceId: entry.referenceId ?? null,
        description: entry.description ?? null,
      })
    },

    async getTrustworthySummary(ctx) {
      const entries = await repo.capitalLedger.findMany(ctx, { take: 10000 })
      const summary: TrustworthyCapitalSummary = {
        available: 0, committed: 0, spent: 0,
        expectedReturn: 0, realizedReturn: 0, reinvestmentPool: 0,
        currency: 'USD',
        synthetic: 0, ownerFunded: 0, earnedRevenue: 0, reinvestedProfit: 0,
        verifiedAvailable: 0, syntheticAvailable: 0,
      }
      for (const e of entries) {
        const amount = e.amount
        const prov = e.provenance
        const isVerified = e.verificationStatus === 'VERIFIED'

        // Track by provenance
        if (prov === 'SYNTHETIC') summary.synthetic += amount
        else if (prov === 'OWNER_FUNDED') summary.ownerFunded += amount
        else if (prov === 'EARNED_REVENUE') summary.earnedRevenue += amount
        else if (prov === 'REINVESTED_PROFIT') summary.reinvestedProfit += amount

        // Track by type
        switch (e.type) {
          case 'AVAILABLE':
            summary.available += amount
            if (prov === 'SYNTHETIC') summary.syntheticAvailable += amount
            else if (isVerified) summary.verifiedAvailable += amount
            break
          case 'COMMITTED': summary.committed += amount; break
          case 'SPENT': summary.spent += amount; break
          case 'EXPECTED_RETURN': summary.expectedReturn += amount; break
          case 'REALIZED_RETURN': summary.realizedReturn += amount; break
          case 'REINVESTMENT': summary.reinvestmentPool += amount; break
        }
        summary.currency = e.currency || 'USD'
      }
      // Verified available = real capital minus committed minus spent + realized returns + reinvestment
      summary.verifiedAvailable = Math.max(0,
        summary.verifiedAvailable - summary.committed - summary.spent +
        summary.realizedReturn + summary.reinvestmentPool
      )
      return summary
    },

    async canAuthorizeSpend(ctx, amount) {
      const summary = await this.getTrustworthySummary(ctx)
      return summary.verifiedAvailable >= amount
    },

    async recordEarnedRevenue(ctx, entry) {
      await this.recordCapital(ctx, {
        type: 'REALIZED_RETURN',
        amount: entry.amount,
        source: entry.source,
        provenance: 'EARNED_REVENUE',
        verificationStatus: 'VERIFIED',
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        description: entry.description,
        verifiedBy: entry.verifiedBy,
      })
      // Also add to available capital (reinvestment pool)
      await this.recordCapital(ctx, {
        type: 'AVAILABLE',
        amount: entry.amount,
        source: entry.source,
        provenance: 'REINVESTED_PROFIT',
        verificationStatus: 'VERIFIED',
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        description: `Reinvestment from earned revenue: ${entry.description ?? ''}`,
        verifiedBy: entry.verifiedBy,
      })
    },
  }
}
