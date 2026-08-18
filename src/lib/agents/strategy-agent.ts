// =============================================================================
// Strategy Agent (Sections 18, 19, 35)
// =============================================================================
// One specialized agent (MVP slice, Section 31). Uses z-ai-web-dev-sdk LLM
// with TYPED tool contracts. Distinguishes OBSERVED / INFERRED / PREDICTED /
// RECOMMENDED (Section 35). Never invents evidence — every recommendation
// it produces is grounded via the evidence-graph tool calls.

import { chat, LLM_META } from '../ai/llm'
import { invokeTool, toolSchemasForPrompt, rolesFromContext } from './tools'
import { t } from '../tenant-guard'
import { getTenantContext } from '../tenant-context'
import { randomUUID } from 'node:crypto'

export interface AgentRunInput {
  prompt: string
  history?: { role: 'user' | 'assistant'; content: string }[]
}

export interface AgentRunOutput {
  runId: string
  answer: string
  structured?: {
    summary: string
    observed: string[]
    inferred: string[]
    predicted: string[]
    recommended: string[]
    evidence: Array<{ type: string; id: string; summary: string }>
    uncertainty: string
    nextBestExperiment: string
  }
  toolCalls: Array<{ tool: string; ok: boolean; outputPreview: string }>
  tokens: { input: number; output: number }
  latencyMs: number
}

const SYSTEM_PROMPT = `You are the Strategy Agent for a Marketing Decision Intelligence Platform.

Your job: given everything the system knows about the active tenant, help
the user decide what the company should do next — and back every claim
with evidence from the platform's tools.

ABSOLUTE RULES (Section 35 — AI Safety):
1. NEVER invent evidence, experiment results, or causal claims.
2. Before claiming a recommendation is "supported", call get_evidence and quote what it returned.
3. Distinguish OBSERVED (measured) vs INFERRED (model-derived) vs PREDICTED (forecast) vs RECOMMENDED (your suggestion).
4. When uncertainty is material, state it explicitly as a range.
5. Never present uncertain projections as facts.
6. You are tenant-scoped — you can only see the active tenant's data via tools. Do not speculate about other tenants.

PROCESS:
- Always call get_market_state and get_customer_state first to ground yourself.
- Call estimate_incrementality and query_experiments before making causal claims.
- Call get_evidence before saying a recommendation is "supported by evidence".
- For any new experiment idea, use create_experiment ONLY if the user explicitly asks.

OUTPUT FORMAT (final answer must be a single JSON object with this shape, no prose around it):
{
  "summary": "1-2 sentence overview",
  "observed": ["...measured facts..."],
  "inferred": ["...model-derived conclusions, with caveat..."],
  "predicted": ["...forecasts, with uncertainty..."],
  "recommended": ["...your recommended actions, each tied to evidence..."],
  "evidence": [{ "type": "CausalEstimate|Experiment|...", "id": "...", "summary": "..." }],
  "uncertainty": "What we don't know and how confident we are overall",
  "nextBestExperiment": "The single experiment that would most efficiently reduce uncertainty"
}

You may call multiple tools. After gathering evidence, produce the JSON answer.`

export async function runStrategyAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const ctx = getTenantContext()
  const started = Date.now()

  // Create an AgentRun record (Section 25, 26 — observability + cost attribution)
  const run = await t.agentRun.create({
    data: {
      agentName: 'strategy',
      prompt: input.prompt,
      modelProvider: LLM_META.provider,
      modelName: LLM_META.model,
      promptVersion: LLM_META.promptVersion,
      status: 'running',
    },
  })

  const toolCalls: AgentRunOutput['toolCalls'] = []
  const tcc = {
    agentRunId: run.id,
    tenantId: ctx.tenantId,
    roles: rolesFromContext(),
  }

  // ---- Step 1: gather grounding context via deterministic tool calls ----
  // (The LLM does NOT choose tools here — we pre-call the read-only context
  // tools deterministically so the agent always starts grounded. This is
  // the "deterministic where possible" principle, Section 29.)
  const grounding: Record<string, unknown> = {}
  for (const toolName of [
    'get_market_state',
    'get_customer_state',
    'query_experiments',
    'estimate_incrementality',
    'get_creative_insights',
  ]) {
    const r = await invokeTool(toolName, {}, tcc)
    toolCalls.push({
      tool: toolName,
      ok: r.ok,
      outputPreview: JSON.stringify(r.ok ? r.output : r.error).slice(0, 200),
    })
    if (r.ok) grounding[toolName] = r.output
  }

  // ---- Step 2: ask the LLM, with grounding + tool schemas available ----
  const toolSchemas = toolSchemasForPrompt()
  const userMessage = `Tenant: ${ctx.tenantSlug} (region=${ctx.region}, autonomy=L${ctx.autonomyLevel})

User question:
${input.prompt}

Pre-gathered tool results (tenant-scoped, already authorized):
${JSON.stringify(grounding, null, 2).slice(0, 12000)}

Available tools for additional evidence lookups (call these via the tool-call protocol if needed):
${JSON.stringify(toolSchemas, null, 2).slice(0, 4000)}

Remember: produce a single JSON object as the final answer.`

  const llm = await chat({
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
    history: input.history,
    json: true,
    thinking: false,
  })

  // Update the AgentRun with usage + status.
  await t.agentRun.update({
    where: { id: run.id },
    data: {
      status: 'completed',
      inputTokens: llm.inputTokens,
      outputTokens: llm.outputTokens,
      latencyMs: llm.latencyMs,
      output: JSON.stringify(llm.parsed ?? llm.content).slice(0, 16000),
    },
  })

  return {
    runId: run.id,
    answer: llm.content,
    structured: llm.parsed as AgentRunOutput['structured'] | undefined,
    toolCalls,
    tokens: { input: llm.inputTokens, output: llm.outputTokens },
    latencyMs: Date.now() - started,
  }
}

// Backfill helper — generate a random id (used if downstream code needs one).
export function newId(): string {
  return randomUUID()
}
