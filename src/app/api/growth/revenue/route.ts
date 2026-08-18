import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { getRepository } from '@/lib/infrastructure/composition/root'
import { createCapitalProvenanceService } from '@/lib/domain/services/capital-provenance'
import { getTenantContext } from '@/lib/tenant-context'
import { emit } from '@/lib/event-bus'

// =============================================================================
// Revenue Verification API (milestone 4 — conversion + revenue verification)
// =============================================================================
// The first customer must be explicitly marked REAL with a source of truth
// for payment. Then EARNED_REVENUE capital is created automatically. Only
// then does the Growth Decision Engine gain actual marketing capital.

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const {
    prospectId, outreachId, growthExperimentId,
    amount, currency, paymentSource, paymentReference, customerName, notes,
  } = (body ?? {}) as {
    prospectId?: string
    outreachId?: string
    growthExperimentId?: string
    amount: number
    currency?: string
    paymentSource: string // stripe | invoice | paypal | manual_verification
    paymentReference?: string
    customerName?: string
    notes?: string
  }

  if (!amount || amount <= 0) {
    return NextResponse.json({ error: 'amount must be positive' }, { status: 400 })
  }
  if (!paymentSource) {
    return NextResponse.json({ error: 'paymentSource required (stripe | invoice | paypal | manual_verification)' }, { status: 400 })
  }

  const ctx = getTenantContext()
  const repo = getRepository()
  const capitalService = createCapitalProvenanceService(repo)

  // 1. Record the verified earned revenue
  await capitalService.recordEarnedRevenue(ctx, {
    amount,
    source: paymentSource,
    referenceType: 'Prospect',
    referenceId: prospectId ?? null,
    description: `Verified revenue from ${customerName ?? 'customer'}. Payment ref: ${paymentReference ?? 'N/A'}. ${notes ?? ''}`.trim(),
    verifiedBy: ctx.userId ?? 'operator',
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
          revenue: exp.revenue + amount,
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
      amount,
      currency: currency ?? 'USD',
      paymentSource,
      customerName,
      verified: true,
    },
  })

  // 6. Get the updated capital summary
  const summary = await capitalService.getTrustworthySummary(ctx)

  return NextResponse.json({
    ok: true,
    verified: true,
    amount,
    currency: currency ?? 'USD',
    paymentSource,
    capitalAfter: {
      verifiedAvailable: summary.verifiedAvailable,
      earnedRevenue: summary.earnedRevenue,
      reinvestedProfit: summary.reinvestedProfit,
    },
    message: amount === summary.earnedRevenue
      ? `🎉 FIRST VERIFIED CUSTOMER! $${amount} earned revenue recorded. The Growth Decision Engine now has $${summary.verifiedAvailable.toFixed(2)} of real marketing capital.`
      : `$${amount} verified revenue recorded. Total earned revenue: $${summary.earnedRevenue}. Available capital: $${summary.verifiedAvailable.toFixed(2)}.`,
  })
})

export const GET = withTenant(async (_req, { ctx }) => {
  const repo = getRepository()
  const capitalService = createCapitalProvenanceService(repo)
  const summary = await capitalService.getTrustworthySummary(ctx)
  return NextResponse.json({
    verifiedRevenue: summary.earnedRevenue,
    verifiedAvailable: summary.verifiedAvailable,
    reinvestedProfit: summary.reinvestedProfit,
    syntheticCapital: summary.synthetic,
    currency: summary.currency,
    hasEarnedRealRevenue: summary.earnedRevenue > 0,
  })
})
