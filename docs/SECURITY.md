# Security

> Marketing Decision Intelligence Platform — Security Architecture
> References: master prompt Section 24 (Security), Section 5 (Tenant Isolation Invariants), Section 35 (AI Safety).

## 1. Threat model

The platform holds, per tenant: customer PII, marketing spend, creative strategy, causal estimates, and decisions. The most consequential threat is **cross-tenant data leakage** — one tenant querying, retrieving, or inferring another tenant's rows, documents, graph edges, workflow state, credentials, logs, or AI-retrieved context (Section 5 invariants). Secondary threats: credential theft, audit-tampering, AI-fabricated causal claims, and unauthorized high-impact actions.

## 2. Authentication & identity

- **Future**: OIDC/SAML via an external IdP with SCIM provisioning (Section 24). Not implemented in MVP.
- **Current**: the `User` model carries `email`, `name`, and a CSV `roles` field (`ceo,cmo,marketer,analyst,admin`). The HTTP middleware reads `x-user-id` and `x-roles` headers — these would be set by an upstream IdP gateway in production. This is documented as a gap, not hidden.

## 3. Authorization (RBAC)

Roles are stored on `User.roles` and propagated into the `TenantContext.roles` array (see `TENANCY.md`). Authorization is enforced at two layers:

1. **Route layer** — every tenant-scoped route is wrapped in `withTenant` (`src/lib/middleware-tenant.ts`), which establishes the TenantContext before the handler runs. Unauthenticated requests fail closed (no `TenantContext` ⇒ repository throws).
2. **Tool layer** — every agent tool declares `requiredRoles` (e.g. `create_experiment` requires `cmo`). `invokeTool` checks `tcc.roles` against `tool.requiredRoles` and persists `authorized: false` to `AgentToolCall` when denied (`src/lib/agents/tools.ts`).

ABAC (attribute-based) is partially present via `Policy.allowedChannels`, `Policy.allowedActions`, `Policy.maxSpendChangePct`, `Policy.riskThreshold`, `Policy.operatingHours` — the autonomy policy layer (Section 22) — but is not yet wired into every write path.

## 4. Tenant-aware authorization (defense in depth)

Because the environment is SQLite (no PostgreSQL RLS — see ADR-0001), tenant isolation is enforced by **four layered controls** rather than a single database feature:

| Layer | Mechanism                                                                                       | File                              |
| ----- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| 1     | `tenant_id` non-null on every tenant-owned table; cascading delete from `Tenant`                | `prisma/schema.prisma`            |
| 2     | `TenantContext` (AsyncLocalStorage) established by middleware, propagated through every call     | `src/lib/tenant-context.ts`       |
| 3     | Repository guard (`tenantModel<T>`) re-asserts `tenantId` on every read/write — never trusts the caller | `src/lib/tenant-guard.ts`         |
| 4     | Cross-tenant attack tests verify a tenant cannot read, query, or infer another tenant's data     | Section 5 invariants              |

The repository guard throws `TenantIsolationViolation` if (a) no context is active, (b) a caller-supplied `where.tenantId` differs from the context's tenant, or (c) an update tries to reassign `tenantId`. The middleware maps that exception to HTTP 403.

## 5. Encryption

- **In transit**: HTTPS is terminated by the deployment front-end (Caddy / reverse proxy — see `Caddyfile`). The application does not serve plaintext.
- **At rest**: SQLite file is on encrypted storage in production deployments. The MVP does not implement field-level encryption; this is noted as a future item for enterprise tenants.

## 6. Secret management — SecretRef pattern

Section 24: *"Credentials must NEVER live in ordinary business tables."* The implementation enforces this via the `SecretRef` model:

```prisma
model SecretRef {
  id        String   @id @default(cuid())
  label     String
  vaultKey  String   // opaque pointer to a vault entry
  createdAt DateTime @default(now())
}
```

`Connector.config` stores only non-secret configuration as JSON. `Connector.secretRefId` references a `SecretRef`, whose `vaultKey` is an opaque pointer to a vault entry. In the MVP the "vault" is the process environment; in production this is an AWS Secrets Manager / HashiCorp Vault reference. The actual secret value never appears in a tenant-owned business table.

## 7. Immutable audit logs

The `AuditLog` model captures `actorType` (user | agent | system), `actorId`, `action`, `entityType`, `entityId`, and a JSON `detail`. AuditLog rows are append-only by convention (no update/delete path exists in the repository guard's exposed surface for the `auditLog` model — `tenantModel` proxies the Prisma delegate but the codebase never calls `update`/`delete` on it). Every agent tool invocation is also persisted as an `AgentToolCall` row with `input`, `output`, `authorized`, and `durationMs`.

## 8. AI safety (Section 35)

The Strategy Agent's system prompt encodes the absolute rules:
- never invent evidence, experiment results, or causal claims
- call `get_evidence` before claiming a recommendation is "supported"
- distinguish OBSERVED / INFERRED / PREDICTED / RECOMMENDED
- display uncertainty when material
- tenant-scoped — never speculate about other tenants

Tool calls are logged to `AgentToolCall`, so every claim an agent makes can be reconstructed. See `AI_ARCHITECTURE.md` for the full agent safety model.

## 9. Cross-tenant attack testing

Section 5 mandates explicit attack tests. The seed script provisions two tenants (`acme`, `nova`) with disjoint data. The repository guard's `mergeTenant` function throws `TenantIsolationViolation` whenever a caller tries to read or write with the wrong `tenantId`. The test surface (intended location: `tests/tenant-isolation/`) exercises:

1. A tenant-A request cannot query tenant-B's `Customer`, `Campaign`, `Recommendation`, `Decision`, `Event`, `Edge`, or `RawRecord` rows.
2. A tenant-A agent tool call cannot retrieve tenant-B context via `get_market_state`, `get_evidence`, `query_experiments`, etc. (enforced because tools read from the active TenantContext only).
3. A caller attempting to set `where.tenantId` to tenant-B's id while in tenant-A's context receives HTTP 403.
4. Replay of tenant-A's events does not affect tenant-B's state.

## 10. Future work (noted, not implemented)

- OIDC/SAML with SCIM (Section 24)
- Field-level encryption for PII
- Per-tenant encryption keys for enterprise tenants (Tenant.isolationMode='silo')
- ABAC enforcement on every write path (currently Policy is stored but only partially enforced)
- Signed audit-log entries (append-only with hash chaining)
