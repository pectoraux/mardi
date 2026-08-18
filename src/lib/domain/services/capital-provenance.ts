// =============================================================================
// Capital Provenance Service (milestone 1 + reviewer fixes)
// =============================================================================
// INVARIANT: synthetic/test capital can NEVER authorize real-world spending.
// The system distinguishes:
//   SYNTHETIC / TEST      — demo/seed capital, cannot authorize paid execution
//   OWNER_FUNDED          — real money the operator put in
//   EARNED_REVENUE        — real revenue from real customers
//   REINVESTED_PROFIT     — profit reinvested into marketing
//
// REVIEWER FIX 1: verificationLevel (SIMULATED | TEST | MANUALLY_ASSERTED | PAYMENT_VERIFIED)
//   Only PAYMENT_VERIFIED counts toward "VERIFIED CUSTOMER / VERIFIED REVENUE"
//   in the headline metric. manual_verification → MANUALLY_ASSERTED (NOT verified).
//
// REVIEWER FIX 2: contribution profit chain.
//   Revenue ≠ profit ≠ available capital.
//     grossRevenue − refunds − paymentFees − costOfDelivery − taxes = contributionProfit
//     contributionProfit × reinvestmentRate = available marketing capital
//   Conservative default reinvestmentRate = 0.5 (50%) for the first customer.

import type { Repository } from '../repositories'
import type { TenantContext } from '../../tenant-context'
import type { CapitalSummary } from '../entities'

export type CapitalProvenance = 'SYNTHETIC' | 'OWNER_FUNDED' | 'EARNED_REVENUE' | 'REINVESTED_PROFIT'

// REVIEWER FIX 1: verification level replaces the old verificationStatus.
// Only PAYMENT_VERIFIED counts toward verified revenue / verified customers.
export type VerificationLevel = 'SIMULATED' | 'TEST' | 'MANUALLY_ASSERTED' | 'PAYMENT_VERIFIED'

// Map old paymentSource strings to verification levels.
// manual_verification → MANUALLY_ASSERTED (NOT verified).
// stripe/payment_provider with a real transaction reference → PAYMENT_VERIFIED.
const SOURCE_TO_VERIFICATION: Record<string, VerificationLevel> = {
  manual_verification: 'MANUALLY_ASSERTED',
  invoice: 'MANUALLY_ASSERTED', // an invoice is an assertion, not proof of payment
  stripe: 'PAYMENT_VERIFIED',
  paypal: 'PAYMENT_VERIFIED',
  payment_provider: 'PAYMENT_VERIFIED',
}

export interface TrustworthyCapitalSummary extends CapitalSummary {
  // Breakdown by provenance
  synthetic: number
  ownerFunded: number
  earnedRevenue: number
  reinvestedProfit: number
  // What can actually authorize spending (PAYMENT_VERIFIED only)
  verifiedAvailable: number
  // Manually asserted but NOT payment-verified (shown separately, does NOT authorize spend)
  manuallyAsserted: number
  // What cannot authorize spending (synthetic/test)
  syntheticAvailable: number
  // Contribution profit chain (reviewer fix 2)
  grossRevenue: number
  totalRefunds: number
  totalPaymentFees: number
  totalCostOfDelivery: number
  totalTaxes: number
  contributionProfit: number
  reinvestmentRate: number
  // Count of payment-verified customers (for headline metric)
  verifiedCustomerCount: number
}

// Conservative default: only 50% of contribution profit becomes marketing capital.
const DEFAULT_REINVESTMENT_RATE = 0.5

export interface CapitalProvenanceService {
  recordCapital(ctx: TenantContext, entry: {
    type: 'AVAILABLE' | 'COMMITTED' | 'SPENT' | 'EXPECTED_RETURN' | 'REALIZED_RETURN' | 'REINVESTMENT'
    amount: number
    source: string
    provenance: CapitalProvenance
    verificationLevel?: VerificationLevel
    referenceType?: string
    referenceId?: string
    description?: string
    verifiedBy?: string
    // Contribution profit fields (for EARNED_REVENUE)
    grossRevenue?: number
    refunds?: number
    paymentFees?: number
    costOfDelivery?: number
    taxes?: number
    contributionProfit?: number
    reinvestmentRate?: number
  }): Promise<void>

  getTrustworthySummary(ctx: TenantContext): Promise<TrustworthyCapitalSummary>

  /** Returns true ONLY if the tenant has PAYMENT_VERIFIED capital available. */
  canAuthorizeSpend(ctx: TenantContext, amount: number): Promise<boolean>

  /** Records earned revenue with the full contribution profit chain.
   *  verificationLevel is derived from paymentSource:
   *    manual_verification / invoice → MANUALLY_ASSERTED (does NOT count as verified)
   *    stripe / paypal / payment_provider → PAYMENT_VERIFIED (counts as verified)
   */
  recordEarnedRevenue(ctx: TenantContext, entry: {
    grossRevenue: number
    paymentSource: string // stripe | paypal | invoice | manual_verification | ...
    paymentReference?: string
    referenceType?: string
    referenceId?: string
    description?: string
    verifiedBy: string
    // Optional cost breakdown (defaults: 0 for refunds/taxes, estimated fees)
    refunds?: number
    paymentFees?: number
    costOfDelivery?: number
    taxes?: number
    reinvestmentRate?: number
  }): Promise<{ verificationLevel: VerificationLevel; contributionProfit: number; marketingCapital: number }>
}

export function createCapitalProvenanceService(repo: Repository): CapitalProvenanceService {
  return {
    async recordCapital(ctx, entry) {
      await repo.capitalLedger.create(ctx, {
        type: entry.type,
        amount: entry.amount,
        source: entry.source,
        provenance: entry.provenance,
        verificationLevel: entry.verificationLevel ?? (
          entry.provenance === 'SYNTHETIC' ? 'SIMULATED' :
          entry.provenance === 'OWNER_FUNDED' ? 'MANUALLY_ASSERTED' :
          'MANUALLY_ASSERTED'
        ),
        verifiedAt: entry.verificationLevel === 'PAYMENT_VERIFIED' ? new Date() : null,
        verifiedBy: entry.verifiedBy ?? null,
        referenceType: entry.referenceType ?? null,
        referenceId: entry.referenceId ?? null,
        description: entry.description ?? null,
        grossRevenue: entry.grossRevenue ?? null,
        refunds: entry.refunds ?? 0,
        paymentFees: entry.paymentFees ?? 0,
        costOfDelivery: entry.costOfDelivery ?? 0,
        taxes: entry.taxes ?? 0,
        contributionProfit: entry.contributionProfit ?? null,
        reinvestmentRate: entry.reinvestmentRate ?? null,
      })
    },

    async getTrustworthySummary(ctx) {
      const entries = await repo.capitalLedger.findMany(ctx, { take: 10000 })
      const summary: TrustworthyCapitalSummary = {
        available: 0, committed: 0, spent: 0,
        expectedReturn: 0, realizedReturn: 0, reinvestmentPool: 0,
        currency: 'USD',
        synthetic: 0, ownerFunded: 0, earnedRevenue: 0, reinvestedProfit: 0,
        verifiedAvailable: 0, manuallyAsserted: 0, syntheticAvailable: 0,
        grossRevenue: 0, totalRefunds: 0, totalPaymentFees: 0,
        totalCostOfDelivery: 0, totalTaxes: 0,
        contributionProfit: 0, reinvestmentRate: DEFAULT_REINVESTMENT_RATE,
        verifiedCustomerCount: 0,
      }

      for (const e of entries) {
        const amount = e.amount
        const prov = e.provenance as CapitalProvenance
        const vlevel = (e.verificationLevel ?? 'SIMULATED') as VerificationLevel

        // Track by provenance
        if (prov === 'SYNTHETIC') summary.synthetic += amount
        else if (prov === 'OWNER_FUNDED') summary.ownerFunded += amount
        else if (prov === 'EARNED_REVENUE') summary.earnedRevenue += amount
        else if (prov === 'REINVESTED_PROFIT') summary.reinvestedProfit += amount

        // Track contribution profit chain — ONLY for PAYMENT_VERIFIED entries.
        // MANUALLY_ASSERTED revenue is tracked separately (does NOT count toward
        // verified revenue or contribution profit in the headline).
        if (prov === 'EARNED_REVENUE' && vlevel === 'PAYMENT_VERIFIED') {
          summary.grossRevenue += e.grossRevenue ?? amount
          summary.totalRefunds += e.refunds ?? 0
          summary.totalPaymentFees += e.paymentFees ?? 0
          summary.totalCostOfDelivery += e.costOfDelivery ?? 0
          summary.totalTaxes += e.taxes ?? 0
          summary.contributionProfit += e.contributionProfit ?? (amount - (e.refunds ?? 0) - (e.paymentFees ?? 0) - (e.costOfDelivery ?? 0) - (e.taxes ?? 0))
          summary.verifiedCustomerCount += 1
        }

        // Track by type — ONLY PAYMENT_VERIFIED counts toward verifiedAvailable
        switch (e.type) {
          case 'AVAILABLE':
            summary.available += amount
            if (prov === 'SYNTHETIC') {
              summary.syntheticAvailable += amount
            } else if (vlevel === 'PAYMENT_VERIFIED') {
              summary.verifiedAvailable += amount
            } else if (vlevel === 'MANUALLY_ASSERTED') {
              summary.manuallyAsserted += amount
            }
            break
          case 'COMMITTED': summary.committed += amount; break
          case 'SPENT': summary.spent += amount; break
          case 'EXPECTED_RETURN': summary.expectedReturn += amount; break
          case 'REALIZED_RETURN': summary.realizedReturn += amount; break
          case 'REINVESTMENT': summary.reinvestmentPool += amount; break
        }
        summary.currency = e.currency || 'USD'
      }
      // Verified available = PAYMENT_VERIFIED capital minus committed minus spent
      summary.verifiedAvailable = Math.max(0,
        summary.verifiedAvailable - summary.committed - summary.spent
      )
      return summary
    },

    async canAuthorizeSpend(ctx, amount) {
      const summary = await this.getTrustworthySummary(ctx)
      return summary.verifiedAvailable >= amount
    },

    async recordEarnedRevenue(ctx, entry) {
      // REVIEWER FIX 1: derive verification level from payment source
      const verificationLevel: VerificationLevel =
        SOURCE_TO_VERIFICATION[entry.paymentSource] ?? 'MANUALLY_ASSERTED'

      // REVIEWER FIX 2: compute contribution profit
      const gross = entry.grossRevenue
      const refunds = entry.refunds ?? 0
      // Estimate payment fees if not provided (e.g. Stripe ~2.9% + $0.30)
      const paymentFees = entry.paymentFees ?? (
        entry.paymentSource === 'stripe' ? gross * 0.029 + 0.30 :
        entry.paymentSource === 'paypal' ? gross * 0.029 + 0.30 : 0
      )
      const costOfDelivery = entry.costOfDelivery ?? 0
      const taxes = entry.taxes ?? 0
      const contributionProfit = gross - refunds - paymentFees - costOfDelivery - taxes
      const reinvestmentRate = entry.reinvestmentRate ?? DEFAULT_REINVESTMENT_RATE
      const marketingCapital = contributionProfit * reinvestmentRate

      // Record the EARNED_REVENUE entry with the full contribution chain
      await this.recordCapital(ctx, {
        type: 'REALIZED_RETURN',
        amount: gross,
        source: entry.paymentSource,
        provenance: 'EARNED_REVENUE',
        verificationLevel,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        description: `${entry.description ?? 'Earned revenue'}. Payment ref: ${entry.paymentReference ?? 'N/A'}`.trim(),
        verifiedBy: entry.verifiedBy,
        grossRevenue: gross,
        refunds,
        paymentFees,
        costOfDelivery,
        taxes,
        contributionProfit,
        reinvestmentRate,
      })

      // Only add marketing capital to AVAILABLE if PAYMENT_VERIFIED.
      // MANUALLY_ASSERTED revenue is recorded but does NOT become spendable capital.
      if (verificationLevel === 'PAYMENT_VERIFIED') {
        await this.recordCapital(ctx, {
          type: 'AVAILABLE',
          amount: marketingCapital,
          source: entry.paymentSource,
          provenance: 'REINVESTED_PROFIT',
          verificationLevel: 'PAYMENT_VERIFIED',
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          description: `Reinvestment from contribution profit: $${contributionProfit.toFixed(2)} × ${reinvestmentRate} = $${marketingCapital.toFixed(2)}`,
          verifiedBy: entry.verifiedBy,
          reinvestmentRate,
        })
      }

      return { verificationLevel, contributionProfit, marketingCapital }
    },
  }
}
