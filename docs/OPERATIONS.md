# Operations

> Marketing Decision Intelligence Platform — Observability & Cost Attribution
> References: master prompt Sections 25 (Observability), 26 (Cost Attribution).

## 1. Observability

Section 25 mandates instrumenting four metric categories: **application, data, AI, and business**. The frozen architecture says *"Use OpenTelemetry-compatible observability where practical."* The MVP uses lightweight structured logging (`console.error` / `console.log` with `[event-bus]`, `[withTenant]` prefixes) and persists domain-level metrics to the database for later querying. A future migration to OpenTelemetry is mechanical: each persisted metric row maps to an OTLP span/event.

### 1.1 Application metrics

| Metric        | Source                                       | Storage / access                              |
| ------------- | -------------------------------------------- | --------------------------------------------- |
| Latency       | `Date.now()` deltas in `withTenant`, `runStrategyAgent`, `invokeTool` | `AgentRun.latencyMs`, `AgentToolCall.durationMs` |
| Throughput    | Request count per route                       | `Event` table (per-event-type counts)         |
| Errors        | `try/catch` in middleware + connector framework | `Connector.lastError`, `WorkflowStep.error`, `AgentRun.error`, `AgentToolCall.output` (when `ok: false`) |
| Tenant errors | `TenantIsolationViolation` thrown by guard    | Caught in `withTenant` → HTTP 403 + `console.error` |

### 1.2 Data metrics

| Metric            | Source                                       | Storage                                          |
| ----------------- | -------------------------------------------- | ------------------------------------------------ |
| Freshness         | `Connector.lastSyncAt`                        | `/api/connectors` GET                            |
| Quality           | `RawRecord.dataQuality` (`pending | valid | invalid`) | `RawRecord` table; `/api/dashboard` exposes `rawRecordCount` |
| Lineage failures  | (future) — count of `RawRecord` rows with `dataQuality='invalid'` | `RawRecord` table                          |
| Ingestion failures| `Connector.lastSyncStatus` (`ok | partial | failed`) + `lastError` | `Connector` table                          |

### 1.3 AI metrics (Section 25)

Every LLM call is recorded as an `AgentRun` row carrying the full Section 25 attribute set:

| Section 25 attribute | Field                              |
| -------------------- | ---------------------------------- |
| model                | `AgentRun.modelName`               |
| provider             | `AgentRun.modelProvider`           |
| model version        | `AgentRun.modelName` (e.g. `glm-4.6`) |
| prompt version       | `AgentRun.promptVersion` (`v1`)    |
| input/output tokens  | `AgentRun.inputTokens`, `outputTokens` |
| tool calls           | `AgentToolCall` rows linked by `agentRunId` |
| latency              | `AgentRun.latencyMs`               |
| cost                 | Derived: `tokens × model_price`    |
| errors               | `AgentRun.error`, `AgentRun.status = 'failed'` |
| retrievals           | `AgentToolCall.toolName = 'get_evidence'` etc. |
| final action         | `AgentRun.output` (parsed JSON includes `recommended`) |

`invokeTool` records per-tool latency (`AgentToolCall.durationMs`) and authorization outcome (`authorized: boolean`), enabling analysis of which tools dominate agent run time and which calls are being denied by RBAC.

### 1.4 Business metrics (Section 25)

| Metric                       | Source                                   | Storage                                          |
| ---------------------------- | ---------------------------------------- | ------------------------------------------------ |
| Recommendation acceptance    | `Recommendation.status` (`proposed` → `approved` → `executed` → `learned`) | `Recommendation` table                          |
| Experiment outcomes          | `Experiment.decision` (`ship | iterate | kill`) + `learning` | `Experiment` table                              |
| Incremental revenue          | `CausalEstimate.effectSize` × `Campaign.spent` | Derived in `detectOpportunities`               |
| Incremental profit           | `Opportunity.expectedIncrementalProfit`   | `Recommendation.expectedIncrementalProfit`       |
| Decision quality             | `Decision.actualOutcome` vs `expectedOutcome` + `learning` | `Decision` table                                |

The dashboard route (`/api/dashboard`) computes roll-ups on every request: `totalSpend`, `totalRevenue`, `avgCausalLift`, `campaignCount`, `customerCount`, `experimentCount`, `causalEstimateCount`, `recommendationCount`, `decisionCount`, `eventCount`, `rawRecordCount`, `connectorCount`. These are the Section 25 business metrics surfaced to the user.

## 2. Cost attribution

Section 26: *"Every expensive action must be attributable to tenant, workflow, agent, model, feature, experiment."*

### 2.1 Token usage

Persisted on every `AgentRun` (`inputTokens`, `outputTokens`) and implicitly on every `AgentToolCall` (via its parent `AgentRun`). To compute "how much did tenant X's AI operations cost?":

```sql
SELECT
  tenant_id,
  model_name,
  SUM(input_tokens)  AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(input_tokens  * :input_price  + output_tokens * :output_price) AS cost_usd
FROM AgentRun
WHERE tenant_id = :tenant_id
GROUP BY tenant_id, model_name;
```

### 2.2 Compute time

- Per-agent-run: `AgentRun.latencyMs`.
- Per-tool-call: `AgentToolCall.durationMs`.
- Per-route: `withTenant` measures end-to-end latency (currently logged, not yet persisted — future: a `RequestLog` table).

### 2.3 Storage

Each tenant's storage footprint is computable by summing row counts per tenant-owned table:

```sql
SELECT
  (SELECT COUNT(*) FROM RawRecord  WHERE tenant_id = :tid) AS raw_records,
  (SELECT COUNT(*) FROM Event      WHERE tenant_id = :tid) AS events,
  (SELECT COUNT(*) FROM Interaction WHERE tenant_id = :tid) AS interactions,
  (SELECT COUNT(*) FROM Edge        WHERE tenant_id = :tid) AS edges,
  ...
```

The `/api/dashboard` route already surfaces `rawRecordCount`, `eventCount`, etc. — these double as storage-attribution metrics.

### 2.4 External API costs

Currently the only external API is the z-ai LLM. Token-cost attribution covers it. When real connectors ship (Google Ads, Shopify, Meta), each connector should record per-sync cost (API calls, records pulled) on `Connector` or a new `ConnectorSyncLog` table — `Connector.recordsPulled` is the seed of this.

### 2.5 Per-experiment attribution

`Experiment.id` is the natural cost-center key. Future: link `AgentRun` to `Experiment` via `Edge` (an agent run that produces an experiment recommendation should be attributable back to that experiment's ROI).

## 3. Auditability (Section 29)

Section 29: *"Every impactful action must be reconstructable."* The platform satisfies this via:

- `AuditLog` — actor (user | agent | system), action, entity, detail (JSON). Append-only.
- `AgentToolCall` — every tool invocation with input + output + authorization + duration.
- `AgentRun` — every LLM call with prompt + output + token usage + model version.
- `Decision` — immutable ledger of objective, recommendation, evidence, models, assumptions, expected/actual outcome, learning.
- `Event` — every state change, durable and replayable.
- `RawRecord` — verbatim source data, never destroyed.

A reviewer can reconstruct any decision by: `Decision` → `evidence` (JSON listing `Edge` relations) → `Edge` traversal → `CausalEstimate` → `Experiment` → `RawRecord` (via `lineageId`).

## 4. Alerting & SLOs (future)

The MVP does not ship an alerting system. The intended SLOs (when an OTel exporter is added):

- Tenant isolation violations: **0** per window (any non-zero is a P0).
- Connector sync failure rate: < 5% per tenant per day.
- Agent run failure rate: < 2%.
- Decision-to-outcome latency: P50 < 24h (the closed loop should complete within a day for MVP-scale data).

## 5. Related documents

- `AI_ARCHITECTURE.md` — `AgentRun` / `AgentToolCall` schema
- `SECURITY.md` — audit logs and AI safety
- `DEVELOPMENT.md` — how to inspect metrics locally
