# ADR-0001: Environment Adaptation

- **Status**: Accepted
- **Date**: 2024 (MVP phase 0)
- **Decision owner**: orchestrator
- **Related**: master prompt Sections 3 (Frozen Architecture), 4 (Multi-Tenancy), 6 (Data Architecture), 21 (Workflow Orchestration), 8 (Event-First Design); `ARCHITECTURE.md`, `TENANCY.md`, `DATA_MODEL.md`

## Context

The frozen master prompt specifies a production-grade topology: **PostgreSQL + RLS** for operational data, **Object storage + Apache Iceberg** for analytical data, **Graph DB + Vector DB** for semantic data, **Temporal** for durable workflows, and **Kafka/Redpanda** for the event backbone.

The actual runtime environment is a single-process **Next.js 16** application using **Bun**, **Prisma + SQLite** (`db/custom.db`), and the **z-ai-web-dev-sdk** for LLM access. There is no PostgreSQL, no object storage, no Kafka, no Temporal, and no vector database available in the MVP environment.

The frozen architecture explicitly says: *"Treat this architecture as FROZEN unless a contradiction, impossibility, security flaw, scalability flaw, or materially superior technical approach is discovered. You may propose changes only when necessary. Never silently redesign the system."* This ADR documents that the environment imposes an **impossibility** for the MVP slice (the named infrastructure is not present) and records the **minimum-fidelity adaptations** chosen to preserve every architectural invariant.

## Decision

Adapt the frozen architecture to the SQLite environment as follows. Every adaptation preserves the **logical** architecture and invariants; only the **physical** substrate changes.

| Frozen requirement                      | SQLite-environment adaptation                                                                                                          | Invariant preserved                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| PostgreSQL + Row Level Security         | SQLite + `tenant_id` on every tenant-owned table + application-level `TenantContext` (AsyncLocalStorage) + repository-layer guard (`tenant-guard.ts`) that re-asserts `tenant_id` on every read/write | Defense-in-depth tenant isolation (Section 5); cross-tenant query is structurally impossible through the guard |
| Iceberg / lakehouse                     | Structured `RawRecord` table retaining verbatim source JSON + `lineageId` + `schemaVersion` + `dataQuality`                            | RAW preservation (Section 10); lineage; replayability                                                     |
| Graph DB (Knowledge/Evidence/Customer graphs) | Relational `Edge` table (`sourceType, sourceId, relation, targetType, targetId, weight, metadata`) with tenant-scoped unique constraint | Graph semantics preserved; see ADR-0002                                                                   |
| Vector DB                               | Deferred for MVP. Strategy Agent uses LLM-based relevance ranking over pre-gathered tool outputs instead of ANN retrieval              | Tenant-scoped retrieval (no cross-tenant context); reduced recall — documented gap                        |
| Temporal (durable workflows)            | `Workflow` + `WorkflowStep` tables + in-process state-machine worker                                                                   | Workflow state is durable (persisted); retries/idempotency pattern preserved; cross-process durability is a future item |
| Kafka / Redpanda (event backbone)       | `Event` table (durable, replayable, idempotent on `eventId`) + in-process emitter/subscribers (`src/lib/event-bus.ts`)                 | Events are durable, versioned, idempotently consumable (Section 8); no cross-process fan-out (acceptable for MVP) |
| z-ai-web-dev-sdk / LLM                  | Used as-is to power the Strategy Agent. Typed tool contracts (`ToolDef`), tenant-scoped, every call persisted to `AgentToolCall`        | Agent safety (Section 35); auditability (Section 24); cost attribution (Section 26)                       |

## Consequences

**Positive**

- A single `bun run dev` boots the entire platform — no external services required.
- The full closed loop (RAW → CANONICAL → EVENT → CAUSAL → DECISION → LEARNING) can be exercised end-to-end in seconds.
- Every architectural invariant (tenant isolation, lineage, evidence linkage, auditability, AI safety) is preserved.
- Migration to the frozen physical topology is **mechanical**: each plane's tables can be moved to a dedicated store, because all data access goes through the repository guard / event bus / connector framework abstractions.

**Negative**

- No cross-process durability for workflows or event subscribers (a process crash loses in-flight state; persisted `Workflow`/`Event` rows survive but the in-process worker must restart them).
- No native vector search — the Strategy Agent's relevance ranking is bounded by what the deterministic pre-gathered tool calls return (currently 5 read-only tools, ~12 KB of context).
- No RLS — tenant isolation depends on application discipline (the repository guard) plus cross-tenant attack tests, not on a database feature. A future Prisma bypass (e.g. `$queryRaw`) would silently break isolation; the guard deliberately does not expose `$queryRaw`.
- SQLite write throughput limits scale (single writer). Acceptable for MVP; documented as a scaling constraint.

**Mitigations**

- The repository guard **never** exports raw Prisma delegates for tenant-owned models (only `rawDb` for slug → tenant resolution, which is pre-context).
- Cross-tenant attack tests are mandatory before any new tenant-owned model ships.
- The `Event` table is the source of truth — any subscriber can be rebuilt by `replay()`.

## Alternatives considered

1. **Spin up Postgres + Kafka + Temporal locally** — rejected: would violate the "smallest correct slice" principle (Section 30), multiply operational burden, and the environment provides only SQLite.
2. **Use Prisma's `middlewares` to enforce tenant_id** — rejected: middlewares are global and harder to reason about; the explicit `tenantModel<T>` proxy makes the guard visible at every call site and supports fail-closed behavior on missing context.
3. **Defer multi-tenancy until "real" Postgres is available** — rejected: Section 4 calls multi-tenancy a non-negotiable primitive. The MVP must demonstrate isolation works.
4. **Use a JSON column to fake a graph** — rejected: loses queryability and the unique constraint that makes `upsert` idempotent. The dedicated `Edge` table (ADR-0002) preserves graph semantics with relational performance.

## Migration path to the frozen topology

- **PostgreSQL**: change `datasource db { provider = "sqlite" }` to `"postgresql"`, run `prisma migrate`, add RLS policies that mirror the guard's `mergeTenant` rule, then optionally remove the guard (or keep it as a second layer).
- **Iceberg**: write a connector that emits `RawRecord` rows to S3 + Iceberg in addition to SQLite, then backfill.
- **Graph DB**: write a sync job that mirrors `Edge` rows to Neo4j/Neptune; keep `Edge` as the source of truth.
- **Vector DB**: add a `Creative.embedding` column (already scaffolded) populated by an embedding model; query via pgvector / Pinecone.
- **Temporal**: replace the in-process worker with a Temporal client; `Workflow`/`WorkflowStep` rows become Temporal workflow state mirrors.
- **Kafka**: replace `emit()` with a Kafka producer; the `Event` table remains as the durable sink (or move to Kafka compacted topic + materialized view).
