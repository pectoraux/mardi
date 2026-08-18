# AI Architecture

> Marketing Decision Intelligence Platform — Agent Platform, Tool Contracts, Memory & Safety
> References: master prompt Sections 18 (AI / Agent Architecture), 19 (Agent Memory), 35 (AI Safety Requirements).

## 1. Agent platform, not one giant agent

Section 18: *"Do NOT build one giant 'marketing agent.' Build an agent platform with specialized capabilities."* The frozen architecture names eleven agents: Strategy, Research, Market Intelligence, Customer Intelligence, Measurement, Causal, Opportunity, Creative, Budget, Campaign, Optimization.

The MVP (Section 31) ships **one agent**: the **Strategy Agent** (`src/lib/agents/strategy-agent.ts`). The platform infrastructure — typed tool registry, tool-call logging, role authorization, tenant-scoped retrieval, cost attribution — is built so that adding the next ten agents is a matter of writing new agent modules that reuse the same `invokeTool` machinery, not a redesign.

## 2. Typed tool contracts (Section 18)

Agents never receive unrestricted database access. Every capability an agent can exercise is exposed as a `ToolDef` with an explicit contract:

```ts
export interface ToolDef<I = Record<string, unknown>, O = unknown> {
  name: string
  description: string
  inputSchema: Record<string, { type: string; description: string; required?: boolean }>
  requiredRoles: string[]
  handler: (input: I, tcc: ToolCallContext) => Promise<O>
}
```

The MVP tool registry (`src/lib/agents/tools.ts`) implements seven tools, mapped to the Section 18 contract list:

| Tool                       | Section 18 contract       | Required roles          | Side effects                            |
| -------------------------- | ------------------------- | ----------------------- | --------------------------------------- |
| `get_market_state`         | `get_market_state()`       | marketer, analyst, cmo  | read-only                               |
| `get_customer_state`       | `get_customer_state()`     | marketer, analyst, cmo  | read-only                               |
| `get_evidence`             | `get_evidence()`           | marketer, analyst, cmo  | read-only — Evidence Graph traversal    |
| `query_experiments`        | `query_experiments()`      | marketer, analyst, cmo  | read-only                               |
| `estimate_incrementality`  | `estimate_incrementality()`| marketer, analyst, cmo  | read-only — CausalEstimate aggregation  |
| `get_creative_insights`    | `get_creative_insights()`  | marketer, analyst, cmo  | read-only                               |
| `create_experiment`        | `create_experiment()`      | cmo                     | **write** — creates Experiment + emits event |
| `request_approval`         | `request_approval()`       | marketer, cmo           | write — flips Recommendation to `proposed` |

`publish_campaign`, `pause_campaign`, `forecast_budget`, `generate_creative_brief` (Section 18) are deferred.

Every tool invocation goes through `invokeTool(name, input, tcc)` which:

1. **Authorizes** — checks `tcc.roles` against `tool.requiredRoles`. On failure, persists `AgentToolCall.authorized = false` and returns `{ ok: false, error: 'forbidden' }`.
2. **Executes** — calls `tool.handler(input, tcc)` inside the active `TenantContext` (so every Prisma call inside the handler is automatically tenant-scoped).
3. **Logs** — persists an `AgentToolCall` row with `input`, `output` (truncated to 8 KB), `authorized`, `durationMs`.
4. **Observes** — `AgentRun.inputTokens` / `outputTokens` / `latencyMs` are updated by the calling agent after the LLM call.

Because every tool reads through `t.*` (the tenant guard), an agent **cannot** retrieve another tenant's data even if its prompt asked it to — the guard throws `TenantIsolationViolation`, which is logged to `AgentToolCall.output` as an error.

## 3. Agent memory (Section 19)

Section 19 separates five memory types. The MVP implements them as follows:

| Memory type      | Section 19 meaning                              | MVP implementation                                                                                          |
| ---------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Working**      | Current task state                              | The `AgentRun` row (status: running → completed) + the in-flight `grounding` object in `runStrategyAgent`   |
| **Episodic**     | Prior interactions and actions                  | `AgentRun.prompt` + `AgentRun.output` (full LLM output persisted); `AgentToolCall` rows per run             |
| **Semantic**     | Tenant knowledge                                | The tenant's canonical tables (Brand, Product, Customer, Campaign, Creative, Experiment, CausalEstimate)    |
| **Procedural**   | How the organization performs work              | The `Policy` model (autonomy level, allowed channels/actions, max spend change, risk threshold)             |
| **Evidence**     | What has actually been demonstrated             | The Evidence Graph (`Edge` table) + `CausalEstimate` rows                                                   |

Section 19 invariant: *"Never mix private tenant information into global context."* The Strategy Agent's system prompt is **identical across tenants** — it has no tenant-specific text. All tenant-specific grounding is loaded at run time via the typed tools, which read only from the active tenant's data.

## 4. LLM integration

`src/lib/ai/llm.ts` is a thin singleton around `z-ai-web-dev-sdk`:

- `chat(opts)` — single-turn completion. The system prompt is sent as the first `assistant` message (per the SDK's expected convention). Optional `json: true` forces JSON output and parses it into `parsed`. Optional `history` supports multi-turn.
- `LLM_META = { model: 'glm-4.6', provider: 'z-ai', promptVersion: 'v1' }` — stamped onto every `AgentRun` for cost attribution and reproducibility.
- Token usage (`prompt_tokens`, `completion_tokens`) and latency are extracted from the completion and persisted to `AgentRun`.

## 5. Strategy Agent flow

1. **Create `AgentRun`** (status `running`) under the active TenantContext.
2. **Deterministic grounding** — pre-call five read-only tools (`get_market_state`, `get_customer_state`, `query_experiments`, `estimate_incrementality`, `get_creative_insights`). This is the *"deterministic where possible"* principle (Section 29): the LLM does not choose which grounding tools to call — it always starts grounded.
3. **LLM call** — system prompt + grounding + tool schemas + user question, with `json: true`.
4. **Update `AgentRun`** with tokens, latency, and the parsed/serialized output.
5. **Return** `{ runId, answer, structured, toolCalls, tokens, latencyMs }`.

The `structured` output shape enforces the Section 35 distinction: `{ summary, observed, inferred, predicted, recommended, evidence, uncertainty, nextBestExperiment }`.

## 6. AI safety requirements (Section 35)

The Strategy Agent's system prompt encodes the absolute rules:

1. **Never invent evidence, experiment results, or causal claims.**
2. Before claiming a recommendation is "supported", call `get_evidence` and quote what it returned.
3. **Distinguish** OBSERVED (measured) vs INFERRED (model-derived) vs PREDICTED (forecast) vs RECOMMENDED (your suggestion).
4. When uncertainty is material, **state it explicitly as a range**.
5. Never present uncertain projections as facts.
6. **Tenant-scoped** — only see the active tenant's data via tools; do not speculate about other tenants.

Enforcement is layered:

- **Structural** — every tool is tenant-scoped via the repository guard. The LLM cannot bypass this even if its output requests cross-tenant data.
- **Process** — the system prompt requires the LLM to call `get_evidence` before claiming support. The output JSON shape forces the LLM to bucket each claim into `observed` / `inferred` / `predicted` / `recommended`.
- **Auditability** — every `AgentToolCall` is persisted. A reviewer can reconstruct exactly which evidence the agent saw and which claims it made.
- **Decision Engine invariant** — `recordRecommendation` always links the recommendation to its evidence via `linkEvidence`. A recommendation without evidence is structurally incomplete (Section 15).

## 7. Cost attribution (Section 26)

Every `AgentRun` records `modelProvider`, `modelName`, `promptVersion`, `inputTokens`, `outputTokens`, `latencyMs`. Combined with the `tenantId`, this answers *"How much did this tenant's AI operations cost?"* — sum `inputTokens` and `outputTokens` per tenant, multiply by the model's price. `AgentToolCall.durationMs` enables per-tool compute attribution.

## 8. Future agents

Adding a new agent (e.g. `Measurement Agent`) requires:

1. New module under `src/lib/agents/<name>-agent.ts`.
2. Optionally register new tools in `tools.ts` (each with `requiredRoles` and `inputSchema`).
3. New API route `/api/agent/<name>` that wraps `withTenant` + the agent's `run*` function.
4. Reuse `AgentRun` / `AgentToolCall` for observability — no new tables needed.

## 9. Related documents

- `CAUSAL_ARCHITECTURE.md` — `estimate_incrementality` tool source
- `OPERATIONS.md` — AI observability metrics
- `SECURITY.md` — tool authorization and audit logs
