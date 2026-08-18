// =============================================================================
// LocalModelProvider — structured fallback when no LLM API is available.
// =============================================================================
// Generates a deterministic structured response from the grounding data
// embedded in the user message. This is NOT LLM reasoning, but it keeps
// the agent functional and the evidence chain intact. The response is
// clearly marked with fellBack=true so consumers know it's not AI-generated.

import type { LLMProvider, LLMRequest, LLMResult } from '../../../application/ports'

const PROVIDER_NAME = 'local'
const MODEL = 'structured-fallback'
const MODEL_VERSION = 'fallback-v1'

function stripFences(s: string): string {
  let out = s.trim()
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  }
  return out
}

export const LocalModelProvider: LLMProvider = {
  name: PROVIDER_NAME,
  model: MODEL,
  modelVersion: MODEL_VERSION,

  async complete(req: LLMRequest): Promise<LLMResult> {
    const started = Date.now()

    // Extract grounding data from the user message (the strategy agent
    // embeds pre-gathered tool results in the prompt).
    const groundingMatch = req.userMessage.match(
      /Pre-gathered tool results[\s\S]*?(\{[\s\S]*\})\s*Available tools/
    )
    let grounding: Record<string, unknown> = {}
    if (groundingMatch) {
      try { grounding = JSON.parse(groundingMatch[1]) } catch { /* ignore */ }
    }

    const marketState = grounding.get_market_state as
      | { channels?: Array<{ channel: string; spend: number; campaigns: number }>; totalSpend?: number; brands?: unknown[] }
      | undefined
    const customerState = grounding.get_customer_state as
      | { segments?: Array<{ segment: string; count: number; avgLtv: number }>; totalCustomers?: number; totalLtv?: number }
      | undefined
    const experiments = grounding.query_experiments as
      | Array<{ name?: string; hypothesis?: string; decision?: string; learning?: string; methodology?: string }>
      | undefined
    const causal = grounding.estimate_incrementality as
      | Array<{ campaignId?: string; estimates?: Array<{ methodology: string; metric: string; effectSizePct: number; uncertainty: number[]; confidence: number }> }>
      | undefined

    const observed: string[] = []
    if (marketState) {
      observed.push(`Total marketing spend is $${marketState.totalSpend ?? 0} across ${marketState.channels?.length ?? 0} channels.`)
      marketState.channels?.forEach((c) => {
        observed.push(`${c.channel}: $${c.spend} spend, ${c.campaigns} campaign(s).`)
      })
    }
    if (customerState) {
      observed.push(`${customerState.totalCustomers} customers with total LTV $${customerState.totalLtv}.`)
      customerState.segments?.forEach((s) => {
        observed.push(`${s.segment} segment: ${s.count} customers, avg LTV $${s.avgLtv}.`)
      })
    }
    if (experiments) {
      experiments.forEach((e) => {
        observed.push(`Experiment "${e.name}" (${e.methodology}): decision=${e.decision ?? 'pending'}.`)
        if (e.learning) observed.push(`Learning: ${e.learning}`)
      })
    }

    const inferred: string[] = []
    if (causal && causal.length > 0) {
      causal.forEach((c) => {
        c.estimates?.forEach((e) => {
          inferred.push(`${e.methodology} on ${e.metric}: effect ${(e.effectSizePct * 100).toFixed(1)}% (CI [${(e.uncertainty[0] * 100).toFixed(1)}%, ${(e.uncertainty[1] * 100).toFixed(1)}%], confidence ${(e.confidence * 100).toFixed(0)}%).`)
        })
      })
    }

    const recommended: string[] = []
    if (causal && causal.length > 0) {
      const best = causal.flatMap((c) => c.estimates ?? []).sort((a, b) => b.confidence - a.confidence)[0]
      if (best && best.effectSizePct > 0.1) {
        recommended.push(`Scale the campaign with ${best.methodology} lift of +${(best.effectSizePct * 100).toFixed(1)}% — the strongest causal evidence available.`)
      }
    }
    recommended.push('Run a holdout experiment on any budget increase to confirm sustained incrementality.')

    const evidence: Array<{ type: string; id: string; summary: string }> = []
    if (experiments) {
      experiments.slice(0, 2).forEach((e, i) => {
        evidence.push({ type: 'Experiment', id: `exp-${i}`, summary: e.learning ?? e.hypothesis ?? 'Experiment completed' })
      })
    }
    if (causal) {
      causal.flatMap((c) => c.estimates ?? []).slice(0, 2).forEach((e, i) => {
        evidence.push({ type: 'CausalEstimate', id: `ce-${i}`, summary: `${e.methodology} on ${e.metric}: +${(e.effectSizePct * 100).toFixed(1)}%` })
      })
    }

    const structured = {
      summary: 'Based on the available causal evidence and market state, here is what the data supports. (Note: LLM API unavailable — this is a structured fallback, not AI reasoning.)',
      observed: observed.length > 0 ? observed : ['No data available.'],
      inferred,
      predicted: ['Scaling budget proportionally to causal lift should increase incremental revenue, subject to diminishing returns.'],
      recommended,
      evidence,
      uncertainty: 'Confidence depends on the causal methodology and sample size. See evidence citations for specifics.',
      nextBestExperiment: 'Run a geo holdout on the next budget increment to confirm sustained incrementality before full scaling.',
    }

    const content = JSON.stringify(structured, null, 2)
    return {
      content,
      parsed: req.json ? structured : undefined,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Date.now() - started,
      provider: PROVIDER_NAME,
      model: MODEL,
      modelVersion: MODEL_VERSION,
      fellBack: true,
    }
  },
}
