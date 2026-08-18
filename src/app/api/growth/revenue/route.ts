import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { getRepository } from '@/lib/infrastructure/composition/root'
import { createCapitalProvenanceService } from '@/lib/domain/services/capital-provenance'
import { getTenantContext } from '@/lib/tenant-context'
import { emit } from '@/lib/event-bus'

// =============================================================================
// Revenue Verification API (milestone 4 + reviewer fixes)
// =============================================================================
// REVIEWER FIX 1: verificationLevel is derived from paymentSource:
//   manual_verification / invoice → MANUALLY_ASSERTED (does NOT count as verified)
//   stripe / paypal / payment_provider → PAYMENT_VERIFIED (counts as verified)
// Only PAYMENT_VERIFIED counts toward "VERIFIED CUSTOMER / VERIFIED REVENUE".
//
// REVIEWER FIX 2: contribution profit chain.
//   grossRevenue − refunds − paymentFees − costOfDelivery − taxes = contributionProfit
//   contributionProfit × reinvestmentRate (default 0.5) = marketing capital
// Revenue is NOT automatically available capital.

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const {
    prospectId, outreachId, growthExperimentId,
    amount, currency, paymentSource, paymentReference, customerName, notes,
    refunds, paymentFees, costOfDelivery, taxes, reinvestmentRate,
  } = (body ?? {}) as {
    prospectId?: string
    outreachId?: string
    growthExperimentId?: string
    amount: number // gross revenue
    currency?: string
    paymentSource: string // stripe | invoice | paypal | manual_verification
    paymentReference?: string
    customerName?: string
    notes?: string
    // Optional contribution profit breakdown (defaults: estimated fees, 0 for others)
    refunds?: number
    paymentFees?: number
    costOfDelivery?: number
    taxes?: number
    reinvestmentRate?: number
  }

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: 'amount (gross revenue) must be positive' }, { status: 400 })
  }
  if (!paymentSource) {
    return NextResponse.json({ error: 'paymentSource required (stripe | invoice | paypal | manual_verification)' }, { status: 400 })
  }

  const ctx = getTenantContext()
  const repo = getRepository()
  const capitalService = createCapitalProvenanceService(repo)

  // 1. Record the earned revenue with the full contribution profit chain.
  //    Returns verificationLevel + contributionProfit + marketingCapital.
  const revenueResult = await capitalService.recordEarnedRevenue(ctx, {
    grossRevenue: amount,
    paymentSource,
    paymentReference,
    referenceType: 'Prospect',
    referenceId: prospectId ?? null,
    description: `Revenue from ${customerName ?? 'customer'}. ${notes ?? ''}`.trim(),
    verifiedBy: ctx.userId ?? 'operator',
    refunds,
    paymentFees,
    costOfDelivery,
    taxes,
    reinvestmentRate,
  })

  // 2. Update the prospect status to converted
  if (prospectId) {
    await t.prospect.update({
      where: { id: prospectId },
      data: { status: 'converted', outreachState: 'closed' },
    })
  }

  // 3. Update the outreach outcome
  if (outreachId) {
    await t.outreach.update({
      where: { id: outreachId },
      data: { outcome: 'converted', status: 'closed' },
    })
  }

  // 4. Update the growth experiment funnel
  // Use the prospect's experiment if not explicitly provided
  let experimentId = growthExperimentId
  if (!experimentId && prospectId) {
    const p = await t.prospect.findUnique({ where: { id: prospectId } })
    experimentId = p?.growthExperimentId ?? null
  }
  if (experimentId) {
    const exp = await t.growthExperiment.findUnique({ where: { id: experimentId } })
    if (exp) {
      await t.growthExperiment.update({
        where: { id: experimentId },
        data: {
          customers: exp.customers + 1,
          revenue: exp.revenue + amount, // gross revenue
          contributionMargin: exp.contributionMargin + revenueResult.contributionProfit,
          signups: exp.signups + 1,
          activatedUsers: exp.activatedUsers + 1,
        },
      })
    }
  }

  // 5. Emit a conversion event
  await emit('customer_converted', {
    source: 'revenue_verification',
    entityType: 'Prospect',
    entityId: prospectId ?? null,
    properties: {
      grossRevenue: amount,
      contributionProfit: revenueResult.contributionProfit,
      marketingCapital: revenueResult.marketingCapital,
      verificationLevel: revenueResult.verificationLevel,
      paymentSource,
      customerName,
      // Only PAYMENT_VERIFIED counts as a real verified customer
      verified: revenueResult.verificationLevel === 'PAYMENT_VERIFIED',
    },
  })

  // 6. Get the updated capital summary
  const summary = await capitalService.getTrustworthySummary(ctx)

  const isPaymentVerified = revenueResult.verificationLevel === 'PAYMENT_VERIFIED'
  const isFirstVerified = isPaymentVerified && summary.verifiedCustomerCount === 1

  return NextResponse.json({
    ok: true,
    verificationLevel: revenueResult.verificationLevel,
    paymentVerified: isPaymentVerified,
    grossRevenue: amount,
    currency: currency ?? 'USD',
    paymentSource,
    contributionProfit: revenueResult.contributionProfit,
    marketingCapital: revenueResult.marketingCapital,
    capitalAfter: {
      verifiedAvailable: summary.verifiedAvailable,
      manuallyAsserted: summary.manuallyAsserted,
      earnedRevenue: summary.earnedRevenue,
      contributionProfit: summary.contributionProfit,
      verifiedCustomerCount: summary.verifiedCustomerCount,
    },
    message: !isPaymentVerified
      ? `Revenue recorded as MANUALLY_ASSERTED (paymentSource=${paymentSource}). This does NOT count as a verified customer. To count, record with a payment provider (stripe/paypal) and a payment reference.`
      : isFirstVerified
        ? `🎉 FIRST PAYMENT-VERIFIED CUSTOMER! Gross $${amount} → contribution profit $${revenueResult.contributionProfit.toFixed(2)} → marketing capital $${revenueResult.marketingCapital.toFixed(2)} (at 50% reinvestment).`
        : `Payment-verified revenue recorded. Marketing capital added: $${revenueResult.marketingCapital.toFixed(2)}.`,
  })
})

export const GET = withTenant(async (_req, { ctx }) => {
  const repo = getRepository()
  const capitalService = createCapitalProvenanceService(repo)
  const summary = await capitalService.getTrustworthySummary(ctx)
  return NextResponse.json({
    // HEADLINE: only PAYMENT_VERIFIED counts
    verifiedCustomerCount: summary.verifiedCustomerCount,
    verifiedRevenue: summary.grossRevenue, // gross revenue from payment-verified customers
    verifiedAvailable: summary.verifiedAvailable, // spendable marketing capital
    manuallyAsserted: summary.manuallyAsserted, // asserted but NOT payment-verified
    // Contribution profit chain
    grossRevenue: summary.grossRevenue,
    contributionProfit: summary.contributionProfit,
    reinvestmentRate: summary.reinvestmentRate,
    // Legacy fields
    syntheticCapital: summary.synthetic,
    currency: summary.currency,
    hasPaymentVerifiedRevenue: summary.verifiedCustomerCount > 0,
  })
})
