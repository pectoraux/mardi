# MARDI — Level-3 Completion Matrix (Corrected)

**Baseline**: commit `pending`  
**Date**: 2026-08-18  
**Standard**: A capability is Level-3 only when it produces or observes a real external-world effect.

## Reviewer Corrections Applied

1. **Web visibility ≠ AI visibility** — the web search provider is "External Web Intelligence" (Level 3), not "AI Visibility" (which requires querying an actual AI answer system).
2. **Causal validation ≠ external-world Level-3** — it is internal statistical validation (Level 2 production safety gate).
3. **Capital provenance ≠ external-world Level-3** — it is economic governance (Level 2 production control).
4. **PostgreSQL RLS** — now ACTIVE with FORCE + NOBYPASSRLS role (previously a security gap).

## Defense-in-Depth Tenant Isolation — NOW COMPLETE

| Layer | Status | Evidence |
|-------|--------|----------|
| 1. Application TenantContext (AsyncLocalStorage) | ACTIVE | 15 isolation tests pass |
| 2. Repository guard (re-asserts tenantId) | ACTIVE | Proxy intercepts all queries |
| 3. PostgreSQL RLS (FORCE + NOBYPASSRLS) | **ACTIVE** | 14 RLS tests pass; mardi_app role enforces at DB level |

The `neondb_owner` role has `BYPASSRLS=true` (superuser). A dedicated `mardi_app` role with `NOBYPASSRLS` was created. The application uses `mardi_app` for all tenant-scoped queries via `dbApp`. `FORCE ROW LEVEL SECURITY` is enabled on all tenant-owned tables. Even if the application guard is bypassed, the database rejects cross-tenant queries.

## Subsystem Matrix

| Subsystem | Level | Test | External Dependency | Known Limitation |
|-----------|-------|------|---------------------|------------------|
| **Multi-tenancy** | L3 | 15 isolation + 14 RLS tests | PostgreSQL (Neon) | — |
| **Tenant isolation (RLS)** | **L3** | 14 RLS tests: policy exists, filters correctly, blocks cross-tenant, FORCE enabled | PostgreSQL RLS + mardi_app role | — |
| **External Web Intelligence** | **L3** | Real web search + page reading; verified with real brands | z-ai SDK web_search + page_reader | Searches web, not AI answer systems |
| **AI Evaluation** | **L3** | 8/8 tests pass against real Strategy Agent | z-ai LLM | No adversarial tests yet |
| **AI Visibility (actual AI system)** | L1 | Interface defined; not yet querying AI answer systems | None | Needs real AI answer API |
| **Causal validation** | L2 | 6 tests (5/6 pass); safety gate blocks unvalidated estimates | None (internal stats) | Placebo test needs more data |
| **Capital provenance** | L2 | Synthetic cannot authorize spend; only PAYMENT_VERIFIED counts | None (internal control) | No real payment provider connected |
| **Execution pipeline** | L2 | Audit log + event produced; external call simulated | None | External API call simulated |
| **Payment provider (Stripe)** | L2 | Adapter code-complete; webhook verification works | Stripe API (needs STRIPE_SECRET_KEY) | BLOCKED — no credentials |
| **Connector framework** | L2 | Google Ads + Shopify live; 13 stubs | z-ai SDK | 13 connectors are stubs |
| **Event bus** | L2 | Durable Postgres + in-process dispatch | PostgreSQL | No Kafka configured |
| **Workflow engine** | L2 | DB-backed durable; pause/resume/cancel | PostgreSQL | No Temporal configured |
| **Optimization** | L2 | Produces allocation recommendations | None | Not connected to live execution |
| **Agent memory** | L2 | 5 types, tenant-scoped | In-memory store | Not persisted to DB |
| **Model registry** | L2 | 3 models registered | In-memory store | Not persisted to DB |
| **LLM provider** | L3 | ZAI provider active | z-ai SDK | OpenAI/Anthropic not implemented |
| **Email provider** | L2 | Logging adapter (SIMULATION) | None | No real email API |
| **Vector store** | L2 | In-memory cosine similarity | None | No pgvector |
| **Graph store** | L2 | Relational Edge table + BFS | PostgreSQL | No Neo4j |
| **Object store** | L1 | Interface defined | None | No S3/R2 adapter |
| **Search** | L1 | Interface defined | None | No FTS adapter |
| **Observability** | L2 | Console metrics/spans/logs | None | No OTLP export |
| **Billing** | L2 | 4 plans, usage tracking | In-memory | No Stripe billing |
| **Enterprise tenancy** | L1 | Modes defined | None | No routing |
| **Disaster recovery** | L1 | Not implemented | None | No restore drill |

## Level-3 Evidence

### Tenant Isolation (RLS) — Level 3
- **Test executed**: `scripts/test-rls.ts` (14 tests)
- **External system**: PostgreSQL (Neon) with FORCE ROW LEVEL SECURITY
- **Role**: `mardi_app` (NOBYPASSRLS) — cannot bypass RLS even as table owner
- **Results**:
  - Without session variable: 0 rows (fail-closed)
  - With acme session: 2 campaigns (only acme's)
  - Cross-tenant: 0 nova campaigns (blocked)
  - Customer filtering: 80 (only acme's, not 160)
  - FORCE=true on all tables

### External Web Intelligence — Level 3
- **Test executed**: POST /api/ai-visibility with real brand query
- **External system**: z-ai SDK web_search + page_reader (real HTTP requests)
- **Results**: 3 real search results, 3 pages read, competitor detected from real content

### AI Evaluation — Level 3
- **Test executed**: POST /api/ai-eval (8 test cases)
- **External system**: z-ai LLM (real chat completions)
- **Result**: 8/8 passed
