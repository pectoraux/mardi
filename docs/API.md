# API

> Marketing Decision Intelligence Platform — HTTP API Reference
> References: master prompt Section 27 (API Architecture).

## 1. Architecture

Section 27: *"External APIs: REST and/or GraphQL. Internal service communication: gRPC or equivalent typed RPC where appropriate. Asynchronous communication: events. Public APIs should expose business/domain concepts. Do not expose internal service topology."*

The MVP exposes a **REST** API under `/api/*` using Next.js 16 route handlers. All routes except `/api/tenants` and `/api` (health) are **tenant-scoped**: they must be invoked with an `x-tenant-id` header (or `?tenant=<slug>` query param) and are wrapped by `withTenant`, which establishes the `TenantContext` before the handler runs (see `TENANCY.md`).

### Common headers

| Header         | Required? | Purpose                                                  |
| -------------- | --------- | -------------------------------------------------------- |
| `x-tenant-id`  | yes (tenant-scoped routes) | Tenant slug (`acme`, `nova`, ...). Falls back to `?tenant=` then `acme`. |
| `x-user-id`    | no        | Caller's user id (would be set by upstream IdP gateway). |
| `x-roles`      | no        | CSV roles (`ceo,cmo,marketer,analyst,admin`). Default `marketer`. |
| `Content-Type` | POST only | `application/json`.                                       |

### Common response shapes

- Success: `200 OK` with a JSON body whose top-level keys depend on the route.
- Tenant isolation violation: `403 Forbidden` with `{ "error": "..." }`.
- Unknown tenant slug: `404 Not Found` with `{ "error": "unknown tenant: <slug>" }`.
- Bad request: `400 Bad Request` with `{ "error": "..." }`.
- Server error: `500` with `{ "error": "..." }`.

## 2. Routes

### `GET /api`
Health check. Returns `{ "message": "Hello, world!" }`. Not tenant-scoped.

### `GET /api/tenants`
List all tenants. **Not tenant-scoped** (it must be callable before a TenantContext exists).

**Response**:
```json
{
  "tenants": [
    { "slug": "acme", "name": "Acme Coffee Co.", "plan": "standard", "region": "us-east-1", "autonomyLevel": 2, "learningOptIn": true },
    { "slug": "nova", "name": "Nova Skincare",     "plan": "enterprise", "region": "eu-west-1", "autonomyLevel": 1, "learningOptIn": false }
  ]
}
```

Source: `src/app/api/tenants/route.ts`.

### `GET /api/dashboard`
Tenant overview roll-up. Aggregates brands, campaigns, customers, experiments, causal estimates, recommendations, decisions, events, connectors, and raw records into a single payload for the dashboard UI.

**Response keys**: `tenant` (slug, roles, region, autonomyLevel), `brands`, `metrics` (totalSpend, totalRevenue, avgCausalLift, campaignCount, customerCount, experimentCount, causalEstimateCount, recommendationCount, decisionCount, eventCount, rawRecordCount, connectorCount), `channels`, `segments`, `recentEvents`, `connectors`, `rawRecords`.

Source: `src/app/api/dashboard/route.ts`.

### `GET /api/connectors`
List the active tenant's connectors (id, type, name, status, lastSyncAt, lastSyncStatus, lastError, recordsPulled, config) and the set of available connector types (`availableTypes` from the registry).

### `POST /api/connectors`
Run a connector sync. Body:
```json
{ "action": "sync", "connectorId": "<id>" }
```
or
```json
{ "action": "sync", "type": "google_ads" }
```
Triggers `runConnectorSync`, which extracts records, persists RAW, normalizes to canonical upserts, emits events, and updates connector status. Returns `{ ok: true, recordsPulled, eventsEmitted }`.

Source: `src/app/api/connectors/route.ts`.

### `GET /api/events`
List the active tenant's events, newest first. Query params: `?type=<eventType>` (filter), `?limit=<n>` (default 100, max 500). Returns `events[]` with `id, eventId, type, source, entityType, entityId, occurredAt, ingestedAt, schemaVersion, lineageId, properties` (parsed JSON).

Source: `src/app/api/events/route.ts`.

### `GET /api/evidence`
Evidence Graph access. Two modes:

- **`?type=<EntityType>&id=<id>`** — returns the 1-hop evidence chain for that node: `{ nodes: [{type,id,label,kind}], edges: [{source, relation, target, weight}] }`.
- **(no params)** — returns the full graph (up to 500 edges) for the active tenant.

Source: `src/app/api/evidence/route.ts`.

### `GET /api/experiments`
List experiments with their causal estimates. Returns `experiments[]` with id, name, hypothesis, objective, primaryMetric, methodology, status, decision, learning, durationDays, sampleSize, startDate, endDate, causalEstimates.

### `POST /api/experiments`
Create or complete an experiment. Two actions:

- **Create**: `{ "name": "...", "hypothesis": "...", "objective": "...", "primaryMetric": "...", "methodology": "ab_test", "durationDays": 14, "campaignId": "<id>" }` → returns `{ ok: true, id }`.
- **Complete**: `{ "action": "complete", "experimentId": "<id>", "decision": "ship|iterate|kill", "learning": "...", "effectSizePct": 0.15, "uncertaintyLow": 0.05, "uncertaintyHigh": 0.25, "confidence": 0.9 }` → creates the `CausalEstimate` row, links it in the Evidence Graph, emits `experiment_completed`. Returns `{ ok: true, experiment, causalEstimate }`.

Source: `src/app/api/experiments/route.ts`.

### `GET /api/recommendations`
List persisted recommendations (newest 50) + freshly-detected opportunities (computed live by `detectOpportunities`). Each opportunity carries `type` (scale | pause | shift_budget | experiment | creative_refresh), `campaignId`, `description`, `expectedIncrementalRevenue`, `expectedIncrementalProfit`, `confidence`, `uncertainty: {low, high}`, `evidence[]`, `risks[]`, `constraints[]`, `nextBestExperiment`.

### `POST /api/recommendations`
Two actions:

- `{ "action": "detect", "minConfidence": 0.5 }` → returns `{ opportunities }`.
- `{ "action": "create", "opportunity": {...} }` → persists an opportunity as a `Recommendation`, links its evidence via `Edge`, emits `recommendation_created`. Returns `{ ok: true, id }`.

Source: `src/app/api/recommendations/route.ts`.

### `GET /api/decisions`
List the active tenant's decisions (newest 50) with their approvals. Each decision carries id, objective, recommendation, evidence (JSON array of edge relations), modelsUsed, assumptions, expectedOutcome, actualOutcome, confidence, actionTaken, learning, status, createdAt, recommendationId, approvals.

### `POST /api/decisions`
Two actions:

- **Record**: `{ "recommendationId": "<id>", "objective": "...", "approverEmail": "...", "actionTaken": "...", "assumptions": [...], "expectedOutcome": {...} }` → creates an immutable `Decision` + an `Approval`, marks the recommendation `approved`, emits `decision_recorded`. Returns `{ ok: true, id }`.
- **Outcome**: `{ "action": "outcome", "decisionId": "<id>", "actualOutcome": {...}, "learning": "..." }` → fills `Decision.actualOutcome` + `learning`, sets status `learned`, emits `learning_recorded`. Closes the learning loop.

Source: `src/app/api/decisions/route.ts`.

### `POST /api/agent`
Invoke the Strategy Agent. Body:
```json
{ "prompt": "What should we do next with our Google Ads spend?", "history": [{"role":"user","content":"..."}] }
```
Returns `{ runId, answer, structured, toolCalls, tokens, latencyMs }`. The `structured` payload (when the LLM returned valid JSON) carries the Section 35 buckets: `summary`, `observed`, `inferred`, `predicted`, `recommended`, `evidence`, `uncertainty`, `nextBestExperiment`.

Every LLM call is persisted as an `AgentRun` (tokens, latency, model version, prompt version); every tool call as an `AgentToolCall` (input, output, authorized, duration).

Source: `src/app/api/agent/route.ts`.

### `GET /api/autonomy`
Return the active tenant's autonomy configuration: `autonomyLevel`, `region`, `roles`, `environment`, `policies[]` (maxSpendChangePct, allowedChannels, allowedActions, requiresApproval, riskThreshold, operatingHours), and the full Section 22 level reference table (0..5).

### `POST /api/autonomy`
Update the tenant's autonomy level. Body: `{ "autonomyLevel": 3 }`. Updates the `Tenant` row and invalidates the tenant cache so subsequent requests see the new value.

Source: `src/app/api/autonomy/route.ts`.

## 3. Route summary table

| Method | Path                     | Tenant-scoped | Purpose                                                |
| ------ | ------------------------ | ------------- | ------------------------------------------------------ |
| GET    | `/api`                   | no            | Health check                                           |
| GET    | `/api/tenants`           | no            | List tenants                                           |
| GET    | `/api/dashboard`         | yes           | Tenant overview roll-up                                |
| GET    | `/api/connectors`        | yes           | List connectors + available types                      |
| POST   | `/api/connectors`        | yes           | Run connector sync                                     |
| GET    | `/api/events`            | yes           | List events (filterable, paginated)                    |
| GET    | `/api/evidence`          | yes           | Evidence Graph (chain for a node, or full graph)       |
| GET    | `/api/experiments`       | yes           | List experiments + causal estimates                    |
| POST   | `/api/experiments`       | yes           | Create or complete an experiment                       |
| GET    | `/api/recommendations`   | yes           | List recommendations + live opportunities              |
| POST   | `/api/recommendations`   | yes           | Detect opportunities or persist a recommendation       |
| GET    | `/api/decisions`         | yes           | List decisions + approvals                             |
| POST   | `/api/decisions`         | yes           | Record a decision or its outcome                       |
| POST   | `/api/agent`             | yes           | Run the Strategy Agent                                 |
| GET    | `/api/autonomy`          | yes           | Read autonomy level + policies                         |
| POST   | `/api/autonomy`          | yes           | Update autonomy level                                  |

## 4. Future API surface (Section 27)

The frozen architecture names additional domain resources not yet exposed: `/brands`, `/customers`, `/audiences`, `/markets`, `/campaigns`, `/creatives`, `/models`, `/agents`, `/workflows`. These will be added as the platform grows; each is a thin wrapper over the corresponding Prisma model accessed through `t.*` (the tenant guard).

## 5. Related documents

- `TENANCY.md` — `withTenant` middleware, headers
- `DEVELOPMENT.md` — how to add a new route
- `AI_ARCHITECTURE.md` — `/api/agent` internals
- `OPERATIONS.md` — observability of API routes
