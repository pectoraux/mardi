// =============================================================================
// Experiment service (Section 13) + Causal Intelligence (Section 12)
// =============================================================================
// Owns experiments, causal estimates, and the distinction between
// CORRELATION and CAUSATION. The Decision Engine consumes causal estimates
// — never raw correlations — when ranking opportunities.

import { t } from '../tenant-guard'
import { emit } from '../event-bus'
import { linkEvidence } from './evidence-graph'

export interface CreateExperimentInput {
  name: string
  hypothesis: string
  objective: string
  primaryMetric: string
  methodology?: string
  durationDays?: number
  sampleSize?: number
  campaignId?: string
  secondaryMetrics?: string[]
  guardrailMetrics?: string[]
  population?: Record<string, unknown>
}

export async function createExperiment(input: CreateExperimentInput) {
  const exp = await t.experiment.create({
    data: {
      name: input.name,
      hypothesis: input.hypothesis,
      objective: input.objective,
      primaryMetric: input.primaryMetric,
      methodology: input.methodology ?? 'ab_test',
      durationDays: input.durationDays ?? 14,
      sampleSize: input.sampleSize ?? 0,
      campaignId: input.campaignId ?? null,
      secondaryMetrics: input.secondaryMetrics ? JSON.stringify(input.secondaryMetrics) : null,
      guardrailMetrics: input.guardrailMetrics ? JSON.stringify(input.guardrailMetrics) : null,
      population: input.population ? JSON.stringify(input.population) : null,
      status: 'draft',
    },
  })
  await emit('experiment_created', {
    source: 'experiment_service',
    entityType: 'Experiment',
    entityId: exp.id,
    properties: { name: exp.name, methodology: exp.methodology },
  })
  return exp
}

export async function completeExperiment(
  experimentId: string,
  result: {
    decision: 'ship' | 'iterate' | 'kill'
    learning: string
    effectSizePct: number
    uncertaintyLow: number
    uncertaintyHigh: number
    confidence: number
  }
) {
  const exp = await t.experiment.update({
    where: { id: experimentId },
    data: {
      status: 'analyzed',
      decision: result.decision,
      learning: result.learning,
      endDate: new Date(),
    },
  })
  const ce = await t.causalEstimate.create({
    data: {
      experimentId,
      campaignId: exp.campaignId ?? null,
      metric: exp.primaryMetric,
      treatment: 'treatment_arm',
      control: 'control_arm',
      methodology: exp.methodology,
      effectSize: result.effectSizePct,
      effectSizePct: result.effectSizePct,
      uncertaintyLow: result.uncertaintyLow,
      uncertaintyHigh: result.uncertaintyHigh,
      confidence: result.confidence,
      modelVersion: 'ab-test-v1',
      population: exp.population ?? null,
    },
  })
  await linkEvidence(
    { type: 'Experiment', id: experimentId },
    'produced',
    { type: 'CausalEstimate', id: ce.id },
    { metadata: { primary: true } }
  )
  await emit('experiment_completed', {
    source: 'experiment_service',
    entityType: 'Experiment',
    entityId: experimentId,
    properties: { decision: result.decision, lift: result.effectSizePct },
  })
  return { experiment: exp, causalEstimate: ce }
}

/** Aggregate causal estimates keyed by campaign — used by the decision engine. */
export async function getCausalEstimatesByCampaign() {
  const rows = await t.causalEstimate.findMany({ orderBy: { createdAt: 'desc' } })
  // Group by campaignId
  const byCampaign = new Map<string, typeof rows>()
  for (const r of rows) {
    const key = r.campaignId ?? '_none'
    if (!byCampaign.has(key)) byCampaign.set(key, [])
    byCampaign.get(key)!.push(r)
  }
  return byCampaign
}
