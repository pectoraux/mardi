# Development

> Marketing Decision Intelligence Platform — Developer Guide
> References: master prompt Sections 9 (Connector Framework), 18 (Agent Architecture), 32 (Repository Structure), 36 (Definition of Done).

## 1. Prerequisites

- **Bun** ≥ 1.3 (runtime + package manager)
- **Node.js** ≥ 20 (Next.js 16 requirement)
- **SQLite** (bundled with Prisma — no separate server)

Environment variables (set in `.env` or shell):

```bash
DATABASE_URL="file:./db/custom.db"
# z-ai-web-dev-sdk reads its own env (ZAI_API_KEY / config) — see the SDK docs
NODE_ENV=development
```

## 2. Quickstart

```bash
# 1. Install dependencies
bun install

# 2. Create the SQLite database + apply the Prisma schema
bun run db:push            # prisma db push --accept-data-loss
bun run db:generate        # regenerate the Prisma client

# 3. Seed two tenants (acme, nova) with full demo data
bun run scripts/seed.ts

# 4. Start the dev server
bun run dev                # next dev -p 3000 | tee dev.log
```

Open <http://localhost:3000>. The dashboard loads with the `acme` tenant by default; switch tenants via the `x-tenant-id` header or `?tenant=nova` query parameter.

## 3. Useful scripts

| Command                       | What it does                                            |
| ----------------------------- | ------------------------------------------------------- |
| `bun run dev`                 | Start Next.js dev server on port 3000                   |
| `bun run db:push`             | Apply schema to SQLite (destructive — accepts data loss)|
| `bun run db:generate`         | Regenerate `@prisma/client`                             |
| `bun run db:migrate`          | Create a Prisma migration (dev)                         |
| `bun run db:reset`            | Reset migrations + re-seed                              |
| `bun run scripts/seed.ts`     | Wipe + seed two tenants with demo data                  |
| `bun run scripts/test-sync.ts`| Exercise the connector sync flow against seeded data   |
| `bun run lint`                | ESLint                                                  |
| `bun run build`               | Production build (Next.js standalone output)            |

## 4. Project structure

```
my-project/
├── prisma/
│   └── schema.prisma              # Canonical domain schema (all 24 models)
├── db/
│   └── custom.db                  # SQLite database file
├── scripts/
│   ├── seed.ts                    # Two-tenant seed
│   └── test-sync.ts               # Connector sync smoke test
├── src/
│   ├── app/
│   │   ├── api/                   # REST routes (see API.md)
│   │   │   ├── tenants/  dashboard/  connectors/  events/
│   │   │   ├── evidence/  experiments/  recommendations/
│   │   │   ├── decisions/  agent/  autonomy/  route.ts
│   │   ├── page.tsx               # Dashboard UI
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── components/                # shadcn/ui + dashboard tabs
│   │   ├── ui/                    # shadcn primitives
│   │   └── dashboard/             # overview / data / experiments / evidence /
│   │                              # recommendations / decisions / agent tabs
│   ├── lib/
│   │   ├── db.ts                  # PrismaClient singleton
│   │   ├── tenant-context.ts      # TenantContext (AsyncLocalStorage)
│   │   ├── middleware-tenant.ts   # withTenant() HTTP wrapper
│   │   ├── tenant-guard.ts        # Repository-layer tenant_id enforcement
│   │   ├── event-bus.ts           # Durable, replayable Event table + emitter
│   │   ├── connectors/
│   │   │   ├── framework.ts       # Connector SDK + runConnectorSync
│   │   │   ├── google-ads.ts      # Mock Google Ads connector
│   │   │   ├── shopify.ts         # Mock Shopify connector
│   │   │   └── index.ts           # Side-effect imports + re-exports
│   │   ├── intelligence/
│   │   │   ├── experiment.ts      # Experiment + CausalEstimate service
│   │   │   ├── evidence-graph.ts  # Edge traversal
│   │   │   └── decision-engine.ts # Opportunity detection + Decision ledger
│   │   ├── agents/
│   │   │   ├── tools.ts           # ToolDef registry + invokeTool
│   │   │   └── strategy-agent.ts  # The Strategy Agent
│   │   └── ai/
│   │       └── llm.ts             # z-ai-web-dev-sdk wrapper
│   └── hooks/                     # use-mobile, use-toast
├── docs/                          # This directory
├── Caddyfile                      # Reverse-proxy / HTTPS termination
├── package.json
├── tsconfig.json
└── next.config.ts
```

The conceptual structure suggested in Section 32 (`apps/`, `services/`, `packages/`) is collapsed into a single Next.js app for the MVP. The logical boundaries (identity, tenancy, ingestion, intelligence, decision, agents) are preserved as module directories under `src/lib/`.

## 5. How to add a new connector

1. **Create the connector file**: `src/lib/connectors/<name>.ts` (e.g. `meta.ts`).
2. **Implement the `Connector` interface** (from `framework.ts`):

   ```ts
   import type { Connector, ConnectorContext, ExtractedRecord, NormalizeOps } from './framework'
   import { registerConnector } from './framework'

   export const metaConnector: Connector = {
     type: 'meta_ads',
     async extract(ctx, opts): Promise<ExtractedRecord[]> {
       // Hit the Meta Ads API (or mock). Return raw records with
       // sourceRecordId, entityType, occurredAt, payload.
     },
     normalize(raw, ctx): NormalizeOps {
       // Map raw.payload to canonical upserts + events.
       // upserts[].model ∈ 'campaign' | 'ad' | 'customer' | 'interaction' | 'creative'
     },
   }
   registerConnector(metaConnector)
   ```

3. **Register the side-effect import** in `src/lib/connectors/index.ts`:

   ```ts
   import './meta'
   ```

4. **Seed a `Connector` row** for each tenant that should have it (or POST to `/api/connectors` at runtime with the appropriate type).
5. **Test**: `bun run scripts/test-sync.ts` exercises the sync path; verify `RawRecord` rows are created with `lineageId` and the expected canonical rows appear.
6. **Document**: add a row to `DATA_MODEL.md` if you introduced new entity types.

The framework handles retries (`withRetry`), idempotent raw-record persistence, lineage propagation, event emission, and connector status updates. You only implement `extract` and `normalize`.

## 6. How to add a new agent tool

1. **Define the tool** in `src/lib/agents/tools.ts`:

   ```ts
   {
     name: 'forecast_budget',
     description: 'Forecast next-month spend given current run-rate and a delta.',
     inputSchema: {
       deltaPct: { type: 'number', description: 'Spend delta in %', required: true },
     },
     requiredRoles: ['cmo'],
     handler: async (input, tcc) => {
       const i = input as { deltaPct: number }
       const campaigns = await t.campaign.findMany({})
       // ... compute forecast with uncertainty ...
       return { forecast: [...], uncertainty: {...} }
     },
   }
   ```

2. **Add it to the `tools` array**. `invokeTool` automatically:
   - authorizes via `requiredRoles`,
   - runs inside the active TenantContext (so `t.campaign.findMany` is auto-scoped),
   - persists an `AgentToolCall` row with input/output/duration,
3. **Expose to the agent** by adding the tool name to the `grounding` pre-call list in `strategy-agent.ts` if it should be called deterministically, OR let the LLM choose it via `toolSchemasForPrompt()` (already includes every tool in the registry).
4. **Document the contract** in `AI_ARCHITECTURE.md` (Section 2 table).

## 7. Adding a new agent

1. Create `src/lib/agents/<name>-agent.ts` exporting `run<Name>Agent(input)`.
2. Reuse `invokeTool`, `AgentRun`, `AgentToolCall` — no new tables needed.
3. Add an API route `/api/agent/<name>` wrapped in `withTenant`.
4. Document in `AI_ARCHITECTURE.md` Section 8.

## 8. Definition of done (Section 36)

A feature is complete only when it is: implemented, typed, tested, observable, tenant-safe, documented, versioned, migration-safe, recoverable, auditable. Practically:

- **Typed**: every new model field has a Prisma type; every tool has an `inputSchema`; every agent has TS interfaces for input/output.
- **Tested**: smoke test in `scripts/test-sync.ts` or a new script under `tests/`.
- **Observable**: every side effect emits an `Event`; every LLM call writes an `AgentRun`.
- **Tenant-safe**: every new model has `tenantId`; every query goes through `t.*`, never `db.*` (except the pre-context tenant-slug lookup).
- **Documented**: update the relevant `docs/*.md` file.
- **Versioned**: bump `LLM_META.promptVersion` when the system prompt changes; bump `RawRecord.schemaVersion` when a connector payload shape changes; bump `modelVersion` on `CausalEstimate` when methodology changes.

## 9. Debugging tips

- **`TenantContextError: No active TenantContext`** — you called a tenant-scoped function outside `withTenant` / `withTenantContext`. Wrap the call site.
- **`TenantIsolationViolation`** — you passed a `where.tenantId` that doesn't match the active context, or tried to update `tenantId`. Remove the explicit `tenantId` from your `where` / `data` — the guard fills it.
- **`PrismaClientValidationError`** — make sure `bun run db:generate` was run after the last schema change.
- **Empty dashboard** — run `bun run scripts/seed.ts` to populate demo data.

## 10. Related documents

- `API.md` — HTTP routes
- `TENANCY.md` — `withTenant` / `t.*` usage
- `AI_ARCHITECTURE.md` — tool contracts
- `ADR-0001` — environment rationale
