import { NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { t } from '@/lib/tenant-guard'
import { getRepository } from '@/lib/infrastructure/composition/root'
import { createCapitalProvenanceService } from '@/lib/domain/services/capital-provenance'

export const GET = withTenant(async (_req, { ctx }) => {
  const repo = getRepository()
  const capitalService = createCapitalProvenanceService(repo)
  const [experiments, prospects, outreaches, capital, diagnosticRuns] = await Promise.all([
    t.growthExperiment.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    t.prospect.findMany({ take: 500 }),
    t.outreach.findMany({ take: 500 }),
    capitalService.getTrustworthySummary(ctx),
    t.diagnosticRun.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
  ])

  // Funnel aggregation
  const totalExposure = experiments.reduce((s, e) => s + e.exposure, 0)
  const totalLeads = experiments.reduce((s, e) => s + e.leads, 0)
  const totalQualified = experiments.reduce((s, e) => s + e.qualifiedLeads, 0)
  const totalSignups = experiments.reduce((s, e) => s + e.signups, 0)
  const totalCustomers = experiments.reduce((s, e) => s + e.customers, 0)
  const totalRevenue = experiments.reduce((s, e) => s + e.revenue, 0)

  // Outreach stats
  const outreachSent = outreaches.filter((o) => o.status === 'sent' || o.status === 'replied' || o.status === 'closed').length
  const outreachReplied = outreaches.filter((o) => o.status === 'replied' || o.status === 'closed').length
  const responseRate = outreachSent > 0 ? outreachReplied / outreachSent : 0

  // Diagnostic run funnel
  const diagnosticRunsTotal = diagnosticRuns.length
  const promotedToProspect = diagnosticRuns.filter((r) => r.stage === 'promoted_to_prospect').length
  const rejected = diagnosticRuns.filter((r) => r.stage === 'rejected').length
  const pendingReview = diagnosticRuns.filter((r) => r.stage === 'diagnostic_run' || r.stage === 'identified_organization').length

  // Mechanism performance
  const byMechanism = new Map<string, { exposure: number; leads: number; customers: number; revenue: number }>()
  for (const e of experiments) {
    const m = e.acquisitionMechanism
    if (!byMechanism.has(m)) byMechanism.set(m, { exposure: 0, leads: 0, customers: 0, revenue: 0 })
    const agg = byMechanism.get(m)!
    agg.exposure += e.exposure
    agg.leads += e.leads
    agg.customers += e.customers
    agg.revenue += e.revenue
  }

  const pendingApprovals = outreaches.filter((o) => o.status === 'draft').length
  const drafts = outreaches.filter((o) => o.status === 'draft').length

  return NextResponse.json({
    // HEADLINE METRIC — only PAYMENT_VERIFIED customers count
    headline: {
      verifiedCustomers: capital.verifiedCustomerCount,
      paidSpend: 0, // always $0 in this milestone
      verifiedRevenue: capital.grossRevenue, // gross revenue from payment-verified
      manuallyAssertedRevenue: capital.manuallyAsserted, // asserted but NOT verified
      prospects: prospects.length,
      outreachSent,
    },
    capital: {
      verifiedAvailable: capital.verifiedAvailable,
      manuallyAsserted: capital.manuallyAsserted,
      syntheticAvailable: capital.syntheticAvailable,
      // Contribution profit chain
      grossRevenue: capital.grossRevenue,
      contributionProfit: capital.contributionProfit,
      reinvestmentRate: capital.reinvestmentRate,
      totalRefunds: capital.totalRefunds,
      totalPaymentFees: capital.totalPaymentFees,
      totalCostOfDelivery: capital.totalCostOfDelivery,
      totalTaxes: capital.totalTaxes,
      // Legacy
      earnedRevenue: capital.earnedRevenue,
      ownerFunded: capital.ownerFunded,
      reinvestedProfit: capital.reinvestedProfit,
      synthetic: capital.synthetic,
      currency: capital.currency,
      isZeroVerifiedCapital: capital.verifiedAvailable <= 0,
      hasPaymentVerifiedRevenue: capital.verifiedCustomerCount > 0,
      verifiedCustomerCount: capital.verifiedCustomerCount,
    },
    funnel: {
      prospectsIdentified: prospects.length,
      outreachSent,
      outreachReplied,
      responseRate,
      totalExposure,
      totalLeads,
      totalQualified,
      totalSignups,
      totalCustomers,
      totalRevenue,
    },
    diagnosticFunnel: {
      total: diagnosticRunsTotal,
      promotedToProspect,
      rejected,
      pendingReview,
    },
    experiments: experiments.map((e) => ({
      id: e.id,
      name: e.name,
      acquisitionMechanism: e.acquisitionMechanism,
      status: e.status,
      cost: e.cost,
      effortHours: e.effortHours,
      exposure: e.exposure,
      leads: e.leads,
      qualifiedLeads: e.qualifiedLeads,
      customers: e.customers,
      revenue: e.revenue,
      decision: e.decision,
      learning: e.learning,
    })),
    mechanisms: Array.from(byMechanism.entries()).map(([m, agg]) => ({
      mechanism: m,
      exposure: agg.exposure,
      leads: agg.leads,
      customers: agg.customers,
      revenue: agg.revenue,
    })),
    pendingApprovals,
    drafts,
    cashSpend: 0, // always $0 in this milestone
  })
})
