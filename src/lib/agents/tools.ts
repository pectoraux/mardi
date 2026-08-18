// =============================================================================
// Agent tool registry (Section 18)
// =============================================================================
// Agents communicate through TYPED tools with explicit contracts. Tools are:
//   - tenant-scoped (always read from the active TenantContext)
//   - authorized (each tool declares required roles; checked at call time)
//   - logged (every invocation is persisted as an AgentToolCall)
//   - observable / auditable / replayable
//
// Agents do NOT receive unrestricted database access.

import { t } from '../tenant-guard'
import { getTenantContext } from '../tenant-context'
import { getCausalEstimatesByCampaign } from '../intelligence/experiment'
import { getEvidenceChain } from '../intelligence/evidence-graph'

export interface ToolCallContext {
  agentRunId: string
  tenantId: string
  roles: string[]
}

export interface ToolDef<I = Record<string, unknown>, O = unknown> {
  name: string
  description: string
  inputSchema: Record<string, { type: string; description: string; required?: boolean }>
  requiredRoles: string[]
  handler: (input: I, tcc: ToolCallContext) => Promise<O>
}

// ---------------------------------------------------------------------------
// Tool implementations (read-only by default — write tools require 'cmo' role)
// ---------------------------------------------------------------------------

export const tools: ToolDef[] = [
  {
    name: 'get_market_state',
    description:
      'Return a summary of the active tenant\'s market state: brands, products, channels, campaign counts and spend.',
    inputSchema: {},
    requiredRoles: ['marketer', 'analyst', 'cmo'],
    handler: async (_input, tcc) => {
      const brands = await t.brand.findMany({ include: { products: true } as never })
      const campaigns = await t.campaign.findMany({})
      const totalSpend = campaigns.reduce((s, c) => s + (c.spent ?? 0), 0)
      const byChannel = new Map<string, { spend: number; count: number }>()
      for (const c of campaigns) {
        const k = c.channel
        if (!byChannel.has(k)) byChannel.set(k, { spend: 0, count: 0 })
        const e = byChannel.get(k)!
        e.spend += c.spent ?? 0
        e.count += 1
      }
      return {
        tenant: tcc.tenantId,
        brands: brands.map((b) => ({
          name: b.name,
          category: b.category,
          productCount: (b as unknown as { products?: unknown[] }).products?.length ?? 0,
        })),
        channels: Array.from(byChannel.entries()).map(([k, v]) => ({
          channel: k,
          spend: Math.round(v.spend),
          campaigns: v.count,
        })),
        totalSpend: Math.round(totalSpend),
        campaignCount: campaigns.length,
      }
    },
  },
  {
    name: 'get_customer_state',
    description: 'Return customer segments, counts, and aggregate LTV.',
    inputSchema: {},
    requiredRoles: ['marketer', 'analyst', 'cmo'],
    handler: async (_input, _tcc) => {
      const customers = await t.customer.findMany({ take: 5000 })
      const bySegment = new Map<string, { count: number; ltv: number }>()
      let totalLtv = 0
      for (const c of customers) {
        const k = c.segment ?? 'unknown'
        if (!bySegment.has(k)) bySegment.set(k, { count: 0, ltv: 0 })
        const e = bySegment.get(k)!
        e.count += 1
        e.ltv += c.ltv ?? 0
        totalLtv += c.ltv ?? 0
      }
      return {
        totalCustomers: customers.length,
        totalLtv: Math.round(totalLtv),
        segments: Array.from(bySegment.entries()).map(([k, v]) => ({
          segment: k,
          count: v.count,
          avgLtv: Math.round((v.ltv / v.count) * 10) / 10,
        })),
      }
    },
  },
  {
    name: 'get_evidence',
    description:
      'Return the evidence chain for a given node (e.g. a Recommendation). Always use this before claiming a recommendation is supported.',
    inputSchema: {
      type: { type: 'string', description: 'Entity type (Recommendation, Experiment, CausalEstimate, ...)', required: true },
      id: { type: 'string', description: 'Entity id', required: true },
    },
    requiredRoles: ['marketer', 'analyst', 'cmo'],
    handler: async (input, _tcc) => {
      const i = input as { type: string; id: string }
      const chain = await getEvidenceChain({ type: i.type, id: i.id })
      return chain
    },
  },
  {
    name: 'query_experiments',
    description: 'List experiments and their outcomes for the active tenant.',
    inputSchema: {
      status: { type: 'string', description: 'Optional status filter (draft | running | completed | analyzed)' },
    },
    requiredRoles: ['marketer', 'analyst', 'cmo'],
    handler: async (input, _tcc) => {
      const i = (input ?? {}) as { status?: string }
      const exps = await t.experiment.findMany({
        where: i.status ? { status: i.status } : {},
        orderBy: { createdAt: 'desc' },
        take: 20,
      })
      return exps.map((e) => ({
        id: e.id,
        name: e.name,
        hypothesis: e.hypothesis,
        methodology: e.methodology,
        status: e.status,
        decision: e.decision,
        learning: e.learning,
        primaryMetric: e.primaryMetric,
      }))
    },
  },
  {
    name: 'estimate_incrementality',
    description:
      'Return causal estimates grouped by campaign. Use this to ground any claim about whether marketing caused an outcome.',
    inputSchema: {},
    requiredRoles: ['marketer', 'analyst', 'cmo'],
    handler: async (_input, _tcc) => {
      const byCampaign = await getCausalEstimatesByCampaign()
      const out: Array<Record<string, unknown>> = []
      for (const [campId, ests] of byCampaign.entries()) {
        out.push({
          campaignId: campId,
          estimates: ests.map((e) => ({
            methodology: e.methodology,
            metric: e.metric,
            effectSizePct: e.effectSizePct,
            uncertainty: [e.uncertaintyLow, e.uncertaintyHigh],
            confidence: e.confidence,
            modelVersion: e.modelVersion,
          })),
        })
      }
      return out
    },
  },
  {
    name: 'get_creative_insights',
    description: 'List creatives with their hook/promise/cta.',
    inputSchema: {},
    requiredRoles: ['marketer', 'analyst', 'cmo'],
    handler: async (_input, _tcc) => {
      const creatives = await t.creative.findMany({ take: 50 })
      return creatives.map((c) => ({
        id: c.id,
        name: c.name,
        channel: c.channel,
        hook: c.hook,
        promise: c.promise,
        cta: c.cta,
      }))
    },
  },
  {
    name: 'create_experiment',
    description:
      'Create a new experiment. Requires cmo role. Records the experiment and emits an event.',
    inputSchema: {
      name: { type: 'string', description: 'Experiment name', required: true },
      hypothesis: { type: 'string', description: 'What you expect to learn', required: true },
      primaryMetric: { type: 'string', description: 'Primary success metric', required: true },
      campaignId: { type: 'string', description: 'Optional campaign to attach' },
    },
    requiredRoles: ['cmo'],
    handler: async (input, _tcc) => {
      const i = input as { name: string; hypothesis: string; primaryMetric: string; campaignId?: string }
      const { createExperiment } = await import('../intelligence/experiment')
      const exp = await createExperiment({
        name: i.name,
        hypothesis: i.hypothesis,
        objective: i.primaryMetric,
        primaryMetric: i.primaryMetric,
        campaignId: i.campaignId,
      })
      return { id: exp.id, status: exp.status }
    },
  },
  {
    name: 'request_approval',
    description: 'Mark that a recommendation requires human approval before execution.',
    inputSchema: {
      recommendationId: { type: 'string', description: 'Recommendation id', required: true },
      note: { type: 'string', description: 'Why approval is requested' },
    },
    requiredRoles: ['marketer', 'cmo'],
    handler: async (input, _tcc) => {
      const i = input as { recommendationId: string; note?: string }
      const rec = await t.recommendation.update({
        where: { id: i.recommendationId },
        data: { status: 'proposed' },
      })
      return { id: rec.id, status: rec.status, note: i.note ?? 'requires human approval' }
    },
  },
]

// ---------------------------------------------------------------------------
// Authorization + logging wrapper
// ---------------------------------------------------------------------------
export async function invokeTool(
  name: string,
  input: Record<string, unknown>,
  tcc: ToolCallContext
): Promise<{ ok: true; output: unknown } | { ok: false; error: string }> {
  const tool = tools.find((x) => x.name === name)
  if (!tool) return { ok: false, error: `unknown tool: ${name}` }

  // Authorize
  const hasRole = tool.requiredRoles.some((r) => tcc.roles.includes(r) || tcc.roles.includes('admin'))
  if (!hasRole) {
    await t.agentToolCall.create({
      data: {
        agentRunId: tcc.agentRunId,
        toolName: name,
        input: JSON.stringify(input),
        output: JSON.stringify({ error: 'forbidden' }),
        authorized: false,
        durationMs: 0,
      },
    })
    return { ok: false, error: `forbidden: tool ${name} requires roles ${tool.requiredRoles.join(', ')}` }
  }

  const started = Date.now()
  try {
    const output = await tool.handler(input, tcc)
    const durationMs = Date.now() - started
    await t.agentToolCall.create({
      data: {
        agentRunId: tcc.agentRunId,
        toolName: name,
        input: JSON.stringify(input),
        output: JSON.stringify(output).slice(0, 8000),
        authorized: true,
        durationMs,
      },
    })
    return { ok: true, output }
  } catch (err) {
    const durationMs = Date.now() - started
    await t.agentToolCall.create({
      data: {
        agentRunId: tcc.agentRunId,
        toolName: name,
        input: JSON.stringify(input),
        output: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }).slice(0, 8000),
        authorized: true,
        durationMs,
      },
    })
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function toolSchemasForPrompt() {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    requiredRoles: t.requiredRoles,
  }))
}

export function rolesFromContext(): string[] {
  try {
    return getTenantContext().roles
  } catch {
    return ['marketer']
  }
}
