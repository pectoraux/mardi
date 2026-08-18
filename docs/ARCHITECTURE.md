# Architecture

> Marketing Decision Intelligence Platform — Architecture Overview
> References: master prompt Sections 1, 2, 3, 31.

## 1. Product Mission

The platform is a **multi-tenant Marketing Decision Intelligence** system whose purpose is to continuously answer one question:

> Given everything the system knows about a business — its market, customers, competitors, creative, channels, economics, historical experiments, and causal evidence — **what should the company do next, why, with what evidence, at what cost, with what expected incremental impact, and what experiment would most efficiently reduce uncertainty?**

The product is not a CRM, CDP, attribution dashboard, ad manager, content generator, analytics dashboard, or chatbot. Those are capabilities. The core product is **marketing capital allocation + continuous learning** — a Marketing Operating System. The implementation in this repository is the MVP vertical slice defined in Section 31: two tenants, mock Google Ads + Shopify connectors, customer/campaign/experiment data, an Evidence Graph, a Decision Engine, and a single Strategy Agent.

## 2. Core Architectural Principle — The Closed Loop

Everything in the platform participates in a closed loop (Section 2):

```
MARKET → CUSTOMER → HYPOTHESIS → INTERVENTION → EXPERIMENT
   → MEASUREMENT → CAUSAL ESTIMATE → DECISION → EXECUTION
   → OUTCOME → LEARNING → CAPITAL ALLOCATION → NEXT HYPOTHESIS
```

Every important object must be traceable by **tenant, source, time, version, lineage, evidence, model, decision, and outcome**. No business assertion exists without provenance. This loop is the architectural invariant the implementation preserves end-to-end.

### How the closed loop is implemented (ASCII diagram)

```
        ┌──────────────────────────────────────────────────────────────┐
        │  Connector (Google Ads / Shopify)            src/lib/connectors/   │
        │  extract() → RAW RECORD (verbatim)            RawRecord table       │
        └──────────────────────────────────┬───────────────────────────────┘
                                           │ lineage_id (UUID, propagated)
        ┌──────────────────────────────────▼───────────────────────────────┐
        │  Connector.normalize()  → CANONICAL upserts (Campaign/Customer/   │
        │  Interaction/Creative) + EVENT emission   src/lib/connectors/     │
        │                                       framework.ts → event-bus.ts  │
        └──────────────────────────────────┬───────────────────────────────┘
                                           │ Event row + in-process dispatch
        ┌──────────────────────────────────▼───────────────────────────────┐
        │  Experiment Service — createExperiment / completeExperiment       │
        │  src/lib/intelligence/experiment.ts                               │
        │  produces: CausalEstimate (treatment/control/effect/CI/...)       │
        │  links: Experiment --produced--> CausalEstimate (Edge)            │
        └──────────────────────────────────┬───────────────────────────────┘
                                           │ causal estimates available
        ┌──────────────────────────────────▼───────────────────────────────┐
        │  Decision Engine — detectOpportunities / recordRecommendation     │
        │  src/lib/intelligence/decision-engine.ts                          │
        │  links: Recommendation --based_on/supported_by--> Evidence (Edge) │
        │  emits: recommendation_created, decision_recorded, learning_*     │
        └──────────────────────────────────┬───────────────────────────────┘
                                           │ recommendation + evidence chain
        ┌──────────────────────────────────▼───────────────────────────────┐
        │  Strategy Agent (z-ai-web-dev-sdk LLM, typed tools)               │
        │  src/lib/agents/strategy-agent.ts                                 │
        │  OBSERVED / INFERRED / PREDICTED / RECOMMENDED (Section 35)       │
        └──────────────────────────────────┬───────────────────────────────┘
                                           │ recommendation approved
        ┌──────────────────────────────────▼───────────────────────────────┐
        │  Decision Ledger (immutable)  +  Approval  +  Outcome/Learning    │
        │  Decision table — recordDecision / recordDecisionOutcome          │
        └──────────────────────────────────┬───────────────────────────────┘
                                           │ next-best experiment proposed
                                           └─────► back to HYPOTHESIS
```

The same `lineage_id` is propagated from the raw record through every derived object, so any recommendation can be traced back to the exact source records it depends on.

## 3. The Four Planes + Semantic Data Platform (frozen architecture → implementation)

The frozen architecture (Section 3) specifies four planes over a Semantic Data Platform. The implementation maps each plane to concrete modules:

| Plane (frozen)                | Responsibility                                  | Implementation files                                                          |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| **Decision Plane**            | Opportunity detection, diagnosis, recommendations, budgeting | `src/lib/intelligence/decision-engine.ts`, `src/lib/intelligence/experiment.ts` |
| **Execution Plane**           | Campaigns, creative, audiences, experiments, activation | `Campaign`, `AdSet`, `Ad`, `Creative`, `Interaction` models + `/api/experiments`, `/api/connectors` |
| **Knowledge Plane**           | Customer/Market/Evidence graphs                 | `Edge` table (Section 11) + `src/lib/intelligence/evidence-graph.ts`         |
| **Intelligence Plane**        | Causal engine, ML/predictive, GenAI/agents      | `CausalEstimate` model, `src/lib/agents/strategy-agent.ts`, `src/lib/ai/llm.ts` |
| **Semantic Data Platform**    | Operational + Analytical + Semantic stores      | SQLite (single physical store, three logical planes — see `DATA_MODEL.md`)    |

The frozen architecture called for PostgreSQL (operational) + Iceberg (analytical) + Graph DB + Vector DB (semantic). Those were adapted to SQLite + structured raw-record tables + a relational `Edge` table + LLM-based ranking. See `ADR-0001` and `ADR-0002` for the rationale.

## 4. Topology

- **Runtime**: Next.js 16 app-router (single process for MVP), Bun runtime, Prisma + SQLite (`db/custom.db`).
- **External boundary**: REST API under `/api/*` (Section 27). UI is a server-rendered React dashboard at `/`.
- **Async backbone**: in-process Event bus (`src/lib/event-bus.ts`) with durable persistence to the `Event` table (SQLite substitute for Kafka — see ADR-0001).
- **Workflows**: `Workflow` + `WorkflowStep` tables with an in-process state-machine worker (SQLite substitute for Temporal).

## 5. What is intentionally absent in the MVP

Vector DB (deferred; Strategy Agent uses LLM-based relevance ranking instead), MMM/geo-experiment engine (causal estimates are produced via the Experiment Service `completeExperiment` flow), feature-flag system, SCIM, full OIDC/SAML (noted as future in `SECURITY.md`). These are documented as gaps, not silently redesigned.

## 6. Hexagonal Architecture (Ports & Adapters)

> Introduced in the post-MVP hardening pass. See `ADR-0003`, `ADR-0004`, `ADR-0005` for the rationale.

The MVP coupled the domain layer to specific infrastructure: Prisma (persistence), `z-ai-web-dev-sdk` (LLM), the in-process event bus, the in-process workflow worker, the relational `Edge` table (graph), and (in the future) the relational `Creative.embedding` column (vector) and the local file system (object storage). A senior architect's hardening review flagged the risk: *"SQLite + Prisma is being treated as if it were a production equivalent of PostgreSQL + RLS. It isn't."* The hardening pass introduces **port interfaces** in `src/lib/domain/ports/` (and `src/lib/domain/repositories/` for persistence) that the domain layer depends on, and **adapter implementations** in `src/lib/infrastructure/` that the ports are bound to at runtime. The domain layer **never** imports an infrastructure package — enforced by an ESLint `no-restricted-imports` rule that fails CI.

### Diagram

```
                                ┌──────────────────────────────────────────────┐
                                │  DOMAIN CORE                                 │
                                │  decision-engine · experiment · evidence-    │
                                │  graph · strategy-agent · tools · workflow   │
                                │  (depends only on PORT INTERFACES)           │
                                └────────────────────────┬─────────────────────┘
                                                         │ imports
        ┌────────────────────────────────────────────────▼────────────────────────────────────────────┐
        │  PORT INTERFACES      (src/lib/domain/ports/   +   src/lib/domain/repositories/)            │
        │                                                                                                │
        │   Repository          LLMProvider        EventBus          WorkflowEngine                   │
        │   (I*Repository)      (LLMProvider)      (EventBus)        (WorkflowEngine)                 │
        │                                                                                                │
        │   VectorStore         GraphStore         ObjectStore                                        │
        │   (VectorStore)       (GraphStore)       (ObjectStore)                                      │
        └────────────────────────┬───────────────────────────────────────────────────────────────────┘
                                 │ implemented by
        ┌────────────────────────▼───────────────────────────────────────────────────────────────────┐
        │  INFRASTRUCTURE ADAPTERS    (src/lib/infrastructure/)                                       │
        │                                                                                            │
        │   PrismaAdapter          ZAIProvider           InProcessEventBus       InProcessWorkflow    │
        │   (SQLite / Postgres,    OpenAIProvider        KafkaEventBus           TemporalWorkflow     │
        │    via DATABASE_PROVIDER)AnthropicProvider     (future)                (future)             │
        │                          GeminiProvider                                                  │
        │                          LocalModelProvider                                              │
        │                                                                                            │
        │   PgVectorStore         RelationalGraphStore    LocalObjectStore                             │
        │   (future)              (Edge table — ADR-0002)  S3ObjectStore                               │
        │   PineconeVectorStore   Neo4jGraphStore         (future)                                    │
        │   (future)              (future)                                                            │
        └────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Ports in scope

| Port                  | Location                                  | Adapters                                                                                   | ADR / Notes                                                   |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Repository**        | `src/lib/domain/repositories/`            | `PrismaAdapter` (SQLite & Postgres via `DATABASE_PROVIDER`)                                | ADR-0003 — provider-agnostic persistence; domain never imports Prisma |
| **LLMProvider**       | `src/lib/domain/ports/LLMProvider.ts`     | `ZAIProvider` (active), `OpenAIProvider`/`AnthropicProvider`/`GeminiProvider` (stubs), `LocalModelProvider` (fallback) | ADR-0004 — model economics can change without an agent rewrite |
| **EventBus**          | `src/lib/domain/ports/EventBus.ts`        | `InProcessEventBus` (current MVP, durable `Event` table); `KafkaEventBus` (future)         | ADR-0001 — Kafka substitute                                   |
| **WorkflowEngine**    | `src/lib/domain/ports/WorkflowEngine.ts`  | `InProcessWorkflowEngine` (current MVP, `Workflow`/`WorkflowStep` tables); `TemporalWorkflowEngine` (future) | ADR-0001 — Temporal substitute                                |
| **VectorStore**       | `src/lib/domain/ports/VectorStore.ts`     | `PgVectorStore` (future, Postgres + pgvector); `PineconeVectorStore` (future)              | ADR-0001 — Vector DB deferred for MVP                          |
| **GraphStore**        | `src/lib/domain/ports/GraphStore.ts`      | `RelationalGraphStore` (`Edge` table, current MVP); `Neo4jGraphStore` (future)             | ADR-0002 — Evidence Graph as relational edges                  |
| **ObjectStore**       | `src/lib/domain/ports/ObjectStore.ts`     | `LocalObjectStore` (current MVP, `public/` & `db/` files); `S3ObjectStore` (future)        | ADR-0001 — Iceberg substitute                                  |

### Rules

1. **Domain never imports infrastructure.** `src/lib/domain/**` and `src/lib/agents/**` may import only from `src/lib/domain/**` and from declared external packages that are *not* infrastructure SDKs (`@prisma/client`, `z-ai-web-dev-sdk`, `openai`, `@anthropic-ai/sdk`, `@google/generative-ai`, vendor SDKs, cloud SDKs). Enforced by ESLint `no-restricted-imports`; CI fails on violation.
2. **Ports are infrastructure-agnostic.** They expose domain entity types and normalized result types — never provider-native shapes (no Prisma row types, no SDK response objects).
3. **Adapters are selected at runtime via configuration.** `DATABASE_PROVIDER` selects the persistence adapter; `LLM_PROVIDER` / `Tenant.llmProvider` selects the LLM adapter; `EVENT_BUS_PROVIDER` selects the event bus; and so on. Adapter selection is a deployment concern, not a code-change concern.
4. **Each port has at least one fallback adapter that works without external services.** `LocalModelProvider` (deterministic, no LLM), `InProcessEventBus` (no Kafka), `LocalObjectStore` (no S3), `RelationalGraphStore` (no Neo4j). This is what lets the MVP run with `bun run dev` and no external dependencies, while production swaps adapters without code changes.

### Hardening ADRs

- `ADR-0003` — Repository port/adapter (provider-agnostic persistence)
- `ADR-0004` — LLM provider abstraction (model-agnostic agent system)
- `ADR-0005` — Execution modes (SIMULATION / SANDBOX / LIVE) — the safety axis orthogonal to autonomy level

## 7. Related Documents

- `TENANCY.md` — tenant isolation strategy
- `DATA_MODEL.md` — three data planes + canonical domain model
- `AI_ARCHITECTURE.md` — agent platform
- `CAUSAL_ARCHITECTURE.md` — causal intelligence service
- `ADR-0001`, `ADR-0002` — environment + evidence-graph decisions
- `ADR-0003`, `ADR-0004`, `ADR-0005` — hardening pass (ports & adapters, LLM provider, execution modes)
