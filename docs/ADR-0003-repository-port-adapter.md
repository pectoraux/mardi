# ADR-0003: Repository Port/Adapter (Hexagonal Persistence)

- **Status**: Accepted
- **Date**: 2024 (hardening pass, post-MVP)
- **Decision owner**: orchestrator (architectural hardening)
- **Related**: master prompt Section 3 (Frozen Architecture), Section 4 (Multi-Tenancy), Section 5 (Tenant Isolation), Section 6 (Data Architecture), Section 10 (Data Contracts); `ADR-0001-environment-adaptation.md`, `TENANCY.md`, `DATA_MODEL.md`, `ARCHITECTURE.md`

## Context

ADR-0001 documented the MVP adaptation: PostgreSQL + RLS was substituted with SQLite + an application-level `TenantContext` (AsyncLocalStorage) and a `tenant-guard.ts` proxy that re-asserts `tenant_id` on every read/write. That decision was correct for the MVP slice and preserved every isolation invariant. **However**, a senior architect's hardening review identified a structural risk:

> *"SQLite + Prisma is being treated as if it were a production equivalent of PostgreSQL + RLS. It isn't. The domain layer currently imports Prisma client types directly, and the repository guard is the only seam between domain logic and persistence. If you later swap SQLite for Postgres, add a separate vector store, or introduce a read replica, you will be doing a rewrite — not a configuration change."*

Today, modules such as `src/lib/intelligence/decision-engine.ts`, `src/lib/intelligence/experiment.ts`, `src/lib/connectors/framework.ts`, and `src/lib/agents/tools.ts` all import from `src/lib/db.ts` (the Prisma client wrapper). The tenant guard (`src/lib/tenant-guard.ts`) wraps Prisma delegates, but the **interface** the domain layer sees is still Prisma-shaped. Section 6 of the master prompt calls the data architecture a **contract** (RAW → ADAPTER → CANONICAL → QUALITY → TRUSTED); that contract should be enforced by an interface, not by a database driver.

## Decision

Introduce a **Repository Port** layer in `src/lib/domain/repositories/` and a **Prisma Adapter** in `src/lib/infrastructure/persistence/prisma/`. The domain layer depends **only** on the ports; it never imports `@prisma/client` or `src/lib/db.ts`.

```
                          ┌─────────────────────────────┐
                          │   DOMAIN CORE               │
                          │  decision-engine,           │
                          │  experiment, evidence-graph,│
                          │  strategy-agent, tools      │
                          │  (depends only on PORTS)    │
                          └──────────────┬──────────────┘
                                         │ imports
                          ┌──────────────▼──────────────┐
                          │  PORT INTERFACES             │
                          │  src/lib/domain/repositories/│
                          │  ITenantRepository           │
                          │  ICampaignRepository         │
                          │  IExperimentRepository       │
                          │  ICausalEstimateRepository   │
                          │  IRecommendationRepository   │
                          │  IDecisionRepository         │
                          │  IEdgeRepository             │
                          │  IEventRepository            │
                          │  IAgentToolCallRepository    │
                          │  ...                         │
                          └──────────────┬──────────────┘
                                         │ implemented by
                          ┌──────────────▼──────────────┐
                          │  PERSISTENCE ABSTRACTION     │
                          │  RepositoryProvider         │
                          │  selects by DATABASE_PROVIDER│
                          └──────┬───────────────┬───────┘
                                 │               │
                ┌────────────────▼─────┐   ┌──────▼─────────────────┐
                │  PrismaSqliteAdapter │   │  PrismaPostgresAdapter │
                │  (current MVP)       │   │  (production target)   │
                │  provider=sqlite     │   │  provider=postgresql   │
                │  db/custom.db        │   │  Neon/RDS/Supabase     │
                └──────────────────────┘   └────────────────────────┘
```

### Port rules

1. **Domain never imports Prisma.** A lint rule (`no-restricted-imports`) forbids `@prisma/client`, `src/lib/db.ts`, and `src/lib/tenant-guard.ts` in `src/lib/domain/**` and `src/lib/agents/**`.
2. **Ports are persistence-agnostic.** They expose domain entity types (defined in `src/lib/domain/entities/`), not Prisma model types. A `toDomain(row)` mapper in the adapter converts Prisma rows → domain entities; a `toRow(entity)` mapper goes the other way.
3. **Ports enforce tenant scope.** Every port method takes a `TenantContext` (or is invoked through a `forTenant(tenantId)` factory). The adapter merges `tenant_id` into every `where` clause — this is the same defense-in-depth rule the tenant guard enforced, just relocated to the adapter boundary.
4. **Ports are database-agnostic.** The Prisma adapter uses only portable Prisma operations (`findUnique`, `findMany`, `create`, `update`, `upsert`, `delete`, `count`, `transaction`). No raw SQL, no `$queryRaw`, no `$executeRaw`, no SQLite-specific or Postgres-specific pragmas. The same adapter class works on both `provider = "sqlite"` and `provider = "postgresql"` with no code changes.
5. **`RepositoryProvider` selects the adapter** by the `DATABASE_PROVIDER` environment variable (`prisma_sqlite` | `prisma_postgres`). The default is `prisma_sqlite` for local/dev; production sets `prisma_postgres`. Future values (`prisma_postgres_pooled`, `prisma_postgres_dedicated`) can be added without touching the domain layer.

### Migration path (Section 6 / Section 30 hardening)

| Stage                         | DATABASE_PROVIDER              | Adapter behavior                                                         | When                                              |
| ----------------------------- | ------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------- |
| **1. SQLite bootstrap**       | `prisma_sqlite`                | Single-file SQLite, file-level locking, in-process                       | MVP / local dev / demo                            |
| **2. Postgres production**    | `prisma_postgres`              | Neon/RDS/Supabase, pooled connection string, RLS policies layered on top | First paying customers                            |
| **3. Pooled multi-tenant**    | `prisma_postgres_pooled`       | PgBouncer-style pool, shared schema, `tenant_id` indexed                 | Multi-tenant SaaS                                 |
| **4. Dedicated enterprise**   | `prisma_postgres_dedicated`    | One database per enterprise tenant, schema-tenant binding                | Enterprise tier (Section 4 hybrid model)          |

Stages 3 and 4 are reached by adding a new adapter class (or a new `RepositoryProvider` entry) — **never** by editing domain code. That is the architectural property the hardening pass must guarantee.

## Consequences

**Positive**

- The domain layer is now **persistence-agnostic**. Swapping SQLite → Postgres, adding a read replica, or introducing a vector store (ADR for `IVectorStore` port pending) is a configuration + adapter change, not a domain rewrite.
- The "SQLite ≠ Postgres" risk is **structurally closed**: the domain layer literally cannot express a Prisma-specific query.
- The tenant isolation invariant (Section 5) is enforced at the port boundary (every method carries `tenantId`) **and** the adapter boundary (every `where` clause includes `tenantId`) — defense in depth preserved.
- A second adapter can be added for testing (e.g. an `InMemoryAdapter` for unit tests of the decision engine without spinning up SQLite).
- The migration path in ADR-0001 ("change `provider` to `postgresql`, run `prisma migrate`") is now mechanically achievable: ports are unchanged, only the adapter's connection string and `DATABASE_PROVIDER` change.

**Negative**

- Additional indirection: one interface + one adapter class per repository (currently ~12 ports).
- A `toDomain` / `toRow` mapping step on every read/write — negligible CPU, but more code to maintain.
- Discipline required: the lint rule must be enforced in CI; a single `import { PrismaClient } from '@prisma/client'` in a domain file silently breaks the invariant.
- Ports that need transactional behavior must model it explicitly (e.g. `IUnitOfWork` or `runInTransaction(fn)`) rather than reaching for `prisma.$transaction`.

## Alternatives considered

1. **Keep the tenant guard as the only seam** (status quo) — rejected: the guard is a Prisma-shaped wrapper, not a domain-shaped interface. The domain layer still imports Prisma types, so swapping the database is still a rewrite.
2. **Use Prisma's client extension / middleware to enforce tenant scope and provider selection** — rejected: middlewares are global, hard to test in isolation, and bind the domain layer to Prisma's runtime semantics. The port/adapter split keeps Prisma in the infrastructure layer where it belongs.
3. **Generate ports from the Prisma schema** (codegen) — considered and deferred. Codegen removes boilerplate but couples the port shape to the schema; hand-written ports let the domain evolve independently of the database.
4. **Adopt a full DDD aggregate-root pattern** — rejected for now: overkill for the MVP. Plain repository ports are sufficient to get provider independence; aggregates can be introduced per-bounded-context as complexity grows.

## Migration plan (mechanical refactor)

1. Create `src/lib/domain/entities/` with plain TypeScript types mirroring the Prisma models (Tenant, Campaign, Experiment, CausalEstimate, Recommendation, Decision, Edge, Event, AgentToolCall, …).
2. Create `src/lib/domain/repositories/*.ts` with one interface per aggregate.
3. Create `src/lib/infrastructure/persistence/prisma/PrismaAdapter.ts` implementing every port, delegating to the existing `tenant-guard.ts` wrappers (so behavior is unchanged in stage 1).
4. Create `src/lib/infrastructure/persistence/RepositoryProvider.ts` reading `DATABASE_PROVIDER` and returning the right adapter.
5. Update each domain module to import the port instead of `src/lib/db.ts`. Run the full cross-tenant attack suite (15 tests) at each step.
6. Add the `no-restricted-imports` ESLint rule and fail CI on violation.
7. Verify end-to-end with `DATABASE_PROVIDER=prisma_sqlite` (current MVP), then with `DATABASE_PROVIDER=prisma_postgres` against the existing Neon instance (already provisioned — see Task `10-auth-deploy` worklog).
