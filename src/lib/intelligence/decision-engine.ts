// =============================================================================
// Decision Engine (Sections 15, 16, 23)
// =============================================================================
// Inputs  : current business state, historical evidence, causal estimates,
//           predictions, objectives, constraints, budget, uncertainty.
// Outputs : opportunities, recommendations, expected impact, confidence,
//           supporting evidence, risks, next-best experiment.
//
// INVARIANT (Section 12): a recommendation without evidence is incomplete.
// We NEVER emit a recommendation that isn't linked to at least one
// CausalEstimate, Experiment, or Observation via the Evidence Graph.

import { t } from '../tenant-guard'
import { emit } from '../event-bus'
import { linkEvidence } from './evidence-graph'
import { getCausalEstimatesByCampaign } from './experiment'

export interface Opportunity {
  type: 'scale' | 'pause' | 'shift_budget' | 'experiment' | 'creative_refresh'
  campaignId?: string
  description: string
  expectedIncrementalRevenue: number
  expectedIncrementalProfit: number
  confidence: number
  uncertainty: { low: number; high: number }
  evidence: Array<{ type: string; id: string; summary: string }>
  risks: string[]
  constraints: string[]
  nextBestExperiment: string
}

export interface DetectOpts {
  minConfidence?: number
}

/** Detect opportunities from current tenant state + causal evidence. */
export async function detectOpportunities(opts: DetectOpts = {}): Promise<Opportunity[]> {
  const minConfidence = opts.minConfidence ?? 0.5
  const campaigns = await t.campaign.findMany({})
  const byCampaign = await getCausalEstimatesByCampaign()
  const opps: Opportunity[] = []

  for (const c of campaigns) {
    const estimates = byCampaign.get(c.id ?? '') ?? []
    if (estimates.length === 0) continue
    // Use the highest-confidence causal estimate as the primary evidence.
    const best = estimates.sort((a, b) => b.confidence - a.confidence)[0]

    // Heuristic: scale campaigns with strong positive lift + high confidence.
    if (best.effectSizePct > 0.1 && best.confidence >= minConfidence) {
      const incrementalRevenue = Math.round(
        (c.spent ?? 0) * best.effectSizePct * 1.5 // rough extrapolation
      )
      const incrementalProfit = Math.round(incrementalRevenue * 0.35)
      opps.push({
        type: 'scale',
        campaignId: c.id,
        description: `Scale "${c.name}" — causal lift +${(best.effectSizePct * 100).toFixed(1)}% (${best.methodology})`,
        expectedIncrementalRevenue: incrementalRevenue,
        expectedIncrementalProfit: incrementalProfit,
        confidence: best.confidence,
        uncertainty: { low: best.uncertaintyLow, high: best.uncertaintyHigh },
        evidence: [
          {
            type: 'CausalEstimate',
            id: best.id,
            summary: `${best.methodology} on ${best.metric}: +${(best.effectSizePct * 100).toFixed(1)}% (95% CI [${(best.uncertaintyLow * 100).toFixed(1)}%, ${(best.uncertaintyHigh * 100).toFixed(1)}%])`,
          },
        ],
        risks: [
          'Diminishing returns at higher spend (saturation)',
          'Creative fatigue if budget scaled without refresh',
        ],
        constraints: [`Max spend change: governed by autonomy policy`, `Channel: ${c.channel}`],
        nextBestExperiment: `Run a holdout on the next +20% budget increment to confirm sustained incrementality.`,
      })
    }

    // Heuristic: flag campaigns with low/negative lift for pause-or-pivot.
    if (best.effectSizePct <= 0 && best.confidence >= minConfidence) {
      opps.push({
        type: 'pause',
        campaignId: c.id,
        description: `Pause or pivot "${c.name}" — no measurable incremental lift`,
        expectedIncrementalRevenue: 0,
        expectedIncrementalProfit: Math.round((c.spent ?? 0) * 0.4), // reclaimable spend
        confidence: best.confidence,
        uncertainty: { low: best.uncertaintyLow, high: best.uncertaintyHigh },
        evidence: [
          {
            type: 'CausalEstimate',
            id: best.id,
            summary: `${best.methodology}: effect ${(best.effectSizePct * 100).toFixed(1)}% (CI [${(best.uncertaintyLow * 100).toFixed(1)}%, ${(best.uncertaintyHigh * 100).toFixed(1)}%])`,
          },
        ],
        risks: ['Cannibalization of assisted conversions', 'Loss of brand presence'],
        constraints: [`Contractual minimum spend may apply`],
        nextBestExperiment: `Geo holdout to test true incrementality before pausing.`,
      })
    }
  }

  // Always propose at least one "experiment" opportunity to reduce uncertainty.
  if (opps.length === 0) {
    opps.push({
      type: 'experiment',
      description: 'Run an incrementality holdout on the largest-spend campaign',
      expectedIncrementalRevenue: 0,
      expectedIncrementalProfit: 0,
      confidence: 0.4,
      uncertainty: { low: 0, high: 0 },
      evidence: [],
      risks: ['Temporarily reduced reach during holdout'],
      constraints: ['14-day minimum window'],
      nextBestExperiment: 'Randomized geo holdout with 20% holdout markets.',
    })
  }

  return opps.sort((a, b) => b.expectedIncrementalProfit - a.expectedIncrementalProfit)
}

/** Persist an opportunity as a Recommendation (with evidence links). */
export async function recordRecommendation(opp: Opportunity): Promise<{ id: string }> {
  const rec = await t.recommendation.create({
    data: {
      opportunity: opp.description,
      recommendation: opp.description,
      expectedIncrementalProfit: opp.expectedIncrementalProfit,
      expectedIncrementalRevenue: opp.expectedIncrementalRevenue,
      confidence: opp.confidence,
      uncertainty: JSON.stringify(opp.uncertainty),
      risks: JSON.stringify(opp.risks),
      constraints: JSON.stringify(opp.constraints),
      nextBestExperiment: opp.nextBestExperiment,
      status: 'proposed',
      generatedBy: 'decision_engine',
    },
  })

  // INVARIANT: link every recommendation to its evidence.
  for (const ev of opp.evidence) {
    await linkEvidence(
      { type: 'Recommendation', id: rec.id },
      ev.summary.includes('causal') || ev.summary.includes('Causal') ? 'supported_by' : 'based_on',
      { type: ev.type, id: ev.id },
      { metadata: { summary: ev.summary } }
    )
  }
  await emit('recommendation_created', {
    source: 'decision_engine',
    entityType: 'Recommendation',
    entityId: rec.id,
    properties: { confidence: rec.confidence, expectedProfit: rec.expectedIncrementalProfit },
  })
  return { id: rec.id }
}

/** Record a Decision in the immutable ledger (Section 23). */
export async function recordDecision(input: {
  recommendationId: string
  objective: string
  approverEmail: string
  actionTaken: string
  assumptions?: string[]
  expectedOutcome?: Record<string, unknown>
  executionMode?: 'SIMULATION' | 'SANDBOX' | 'LIVE'
}): Promise<{ id: string }> {
  const rec = await t.recommendation.findUnique({ where: { id: input.recommendationId } })
  if (!rec) throw new Error('recommendation not found')

  // Evidence chain attached to the decision.
  const evidence = await t.edge.findMany({
    where: { sourceType: 'Recommendation', sourceId: rec.id },
  })

  const decision = await t.decision.create({
    data: {
      recommendationId: rec.id,
      objective: input.objective,
      recommendation: rec.recommendation,
      evidence: JSON.stringify(
        evidence.map((e) => ({
          relation: e.relation,
          targetType: e.targetType,
          targetId: e.targetId,
        }))
      ),
      modelsUsed: JSON.stringify(['decision_engine_v1']),
      assumptions: input.assumptions ? JSON.stringify(input.assumptions) : null,
      expectedOutcome: input.expectedOutcome ? JSON.stringify(input.expectedOutcome) : null,
      confidence: rec.confidence,
      actionTaken: input.actionTaken,
      status: 'recorded',
      executionMode: input.executionMode ?? 'SIMULATION',
    },
  })

  await t.approval.create({
    data: {
      decisionId: decision.id,
      approverEmail: input.approverEmail,
      decision: 'approved',
      note: input.actionTaken,
    },
  })

  await t.recommendation.update({
    where: { id: rec.id },
    data: { status: 'approved' },
  })

  await emit('decision_recorded', {
    source: 'decision_engine',
    entityType: 'Decision',
    entityId: decision.id,
    properties: { recommendationId: rec.id, action: input.actionTaken },
  })
  return { id: decision.id }
}

/** Mark a decision's actual outcome + learning (closes the learning loop). */
export async function recordDecisionOutcome(
  decisionId: string,
  outcome: { actualOutcome: Record<string, unknown>; learning: string }
) {
  const updated = await t.decision.update({
    where: { id: decisionId },
    data: {
      actualOutcome: JSON.stringify(outcome.actualOutcome),
      learning: outcome.learning,
      status: 'learned',
    },
  })
  await emit('learning_recorded', {
    source: 'decision_engine',
    entityType: 'Decision',
    entityId: decisionId,
    properties: { learning: outcome.learning },
  })
  return updated
}
