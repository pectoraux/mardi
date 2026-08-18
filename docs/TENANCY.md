# Tenancy

> Marketing Decision Intelligence Platform — Multi-Tenancy Architecture
> References: master prompt Sections 4 (Multi-Tenancy as a Non-Negotiable Primitive) and 5 (Tenant Isolation Invariants).

## 1. Multi-tenancy is a non-negotiable primitive

Section 4: every request must establish an immutable `TenantContext`, propagate it through HTTP → service → workflow → queue → worker → storage → AI tool calls → external actions, and make it difficult or impossible for application code to accidentally execute unscoped cross-tenant queries. The platform must use **defense in depth** — never relying on application-level filtering alone.

The frozen architecture assumed PostgreSQL Row Level Security (RLS) as the database-enforced isolation layer. Because the implementation runs on SQLite (see ADR-0001), RLS is replaced by an **application-level TenantContext + a repository-layer tenant_id guard** that together provide equivalent guarantees.

## 2. Hybrid pooled/silo architecture

Section 4 specifies a HYBRID pooled/silo model:

- **STANDARD tenants (pooled)** — shared infrastructure, `tenant_id` on all tenant-owned entities, tenant-scoped caches/queues/workflows/graph entities, tenant-aware observability.
- **ENTERPRISE tenants (silo)** — can migrate to dedicated PostgreSQL / object storage / compute / encryption key / VPC.

The `Tenant` model captures this:

```prisma
model Tenant {
  id            String   @id @default(cuid())
  slug          String   @unique
  name          String
  plan          String   @default("standard") // standard | enterprise
  region        String   @default("us-east-1")
  autonomyLevel Int      @default(1)          // Section 22: 0..5
  isolationMode String   @default("pooled")   // pooled | silo
  learningOptIn Boolean  @default(false)      // cross-tenant aggregated priors
  ...
}
```

The MVP seed provisions two pooled tenants: `acme` (Acme Coffee Co., standard, us-east-1, autonomy L2, learning opt-in) and `nova` (Nova Skincare, enterprise, eu-west-1, autonomy L1, learning opt-out). The second tenant exists primarily to exercise cross-tenant attack tests.

## 3. TenantContext shape

```ts
export interface TenantContext {
  tenantId: string         // internal cuid (immutable)
  tenantSlug: string       // 'acme' | 'nova' | ...
  organizationId?: string
  userId?: string
  roles: string[]          // ['marketer','cmo','analyst','admin']
  dataScopes: string[]     // ['*'] or scoped facets
  region: string           // 'us-east-1' | 'eu-west-1' | ...
  environment: string      // 'development' | 'production'
  autonomyLevel: number    // Section 22: 0..5
}
```

Source: `src/lib/tenant-context.ts`. The context is **immutable for the lifetime of a request** — once `withTenantContext(ctx, fn)` is entered, only `peekTenantContext()` can read it; nothing in the public API can mutate it.

## 4. Propagation: HTTP → service → repository → storage

```
HTTP request
  headers: x-tenant-id: acme   x-user-id: u_42   x-roles: cmo,marketer
      │
      ▼
withTenant(handler)                          src/lib/middleware-tenant.ts
  1. resolve slug → Tenant record (cache-backed)
  2. buildContext(tenant, { userId, roles })
  3. withTenantContext(ctx, () => handler(req, { ctx }))
      │
      ▼
Route handler (e.g. /api/dashboard)
  reads ctx, calls services
      │
      ▼
Service (e.g. decision-engine.ts, strategy-agent.ts)
  calls into repository layer via the `t` proxy
      │
      ▼
tenant-guard.ts   `t.campaign.findMany({ ... })`
  - reads active TenantContext from AsyncLocalStorage
  - merges `tenantId` into every Prisma `where`
  - injects `tenantId` on every `create`
  - asserts caller-supplied `tenantId` matches context
      │
      ▼
Prisma → SQLite   (every query carries WHERE tenant_id = ?)
```

For background workers (seed scripts, future Temporal-equivalent workers), the caller must explicitly enter a `withTenantContext` before invoking any tenant-scoped code. `peekTenantContext()` returns `undefined` outside a context — the repository guard treats this as a hard error (`TenantIsolationViolation: no active TenantContext`), so background work that forgets to set a context **fails closed** rather than querying cross-tenant.

## 5. Tenant isolation invariants (Section 5)

A tenant must NEVER be able to:

1. query another tenant's rows
2. retrieve another tenant's documents
3. retrieve another tenant's vector embeddings (N/A in MVP — no vector store)
4. retrieve another tenant's graph nodes or edges
5. access another tenant's workflow state
6. access another tenant's credentials
7. observe another tenant's logs
8. infer private tenant data through an API response
9. cause an agent to retrieve another tenant's confidential context

All storage, cache keys, queues, events, logs, metrics, and AI retrievals carry tenant identity.

## 6. How the repository guard enforces isolation

`tenantModel<T>(name)` returns a `Proxy` around the Prisma delegate. For each Prisma method, it:

- **findUnique / findFirst / findMany / count / aggregate / groupBy** — calls `mergeTenant(args.where)` which injects `tenantId: <ctx.tenantId>` unless the caller already set it (in which case it must match).
- **create / createMany** — injects `tenantId` into `data`; throws if caller-supplied `tenantId` differs.
- **update / updateMany / upsert** — merges `tenantId` into `where`; forbids reassigning `tenantId` in `data`.
- **delete / deleteMany** — merges `tenantId` into `where`.

`rawDb` (the un-proxied Prisma client) is exported only for the **slug → tenant resolution** step during authentication, which legitimately runs before a TenantContext exists. All other callers use `t.<model>.*`.

## 7. Tenant-scoped caches, queues, events, graphs

- **Cache**: `tenantCache` in `src/lib/tenant-context.ts` is keyed by slug, holds non-secret tenant metadata only (id, slug, name, autonomyLevel, plan, region, learningOptIn).
- **Events**: every `Event` row carries `tenantId`; `emit()` reads `requireTenantId()` and stamps it. The `replay()` function reads via `t.event.findMany`, so it is automatically scoped.
- **Graph**: every `Edge` row carries `tenantId`; the unique constraint includes `tenantId`.
- **Workflows**: `Workflow` and `WorkflowStep` carry `tenantId`.
- **Agent runs / tool calls**: `AgentRun` and `AgentToolCall` carry `tenantId`; agents can only see their own tenant's runs.

## 8. Cross-tenant attack test approach

Per Section 5 ("Tenant isolation must be tested automatically"), the seed creates two tenants with disjoint data. The intended attack tests (in `tests/tenant-isolation/`) exercise, for each tenant-owned model and each agent tool:

1. **Direct row access** — a request with `x-tenant-id: acme` cannot retrieve any `nova` row.
2. **Inferred leakage** — a `nova` recommendation cannot be linked to `acme` evidence via `Edge`.
3. **Agent retrieval** — `runStrategyAgent` invoked under `acme` cannot see `nova` campaigns, customers, or experiments (enforced because every tool reads through `t.*`).
4. **Replay isolation** — replaying `acme` events does not write `nova` canonical rows.
5. **Spoofed tenantId** — a caller POSTing `{ where: { tenantId: 'nova-id' } }` while in the `acme` context receives HTTP 403 (`TenantIsolationViolation`).

## 9. Related documents

- `ADR-0001-environment-adaptation.md` — why SQLite + app-level guard replaces RLS
- `SECURITY.md` — defense-in-depth summary, audit logs, secret management
- `DATA_MODEL.md` — `tenant_id` on every tenant-owned model
