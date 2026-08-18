# ADR-0005: Execution Modes (SIMULATION / SANDBOX / LIVE)

- **Status**: Accepted
- **Date**: 2024 (hardening pass, post-MVP)
- **Decision owner**: orchestrator (architectural hardening)
- **Related**: master prompt Section 15 (Decision Engine), Section 22 (Autonomy Levels), Section 24 (Security), Section 26 (Cost Attribution), Section 35 (AI Safety); `AI_ARCHITECTURE.md`, `SECURITY.md`, `OPERATIONS.md`, `API.md`

## Context

The MVP implements the closed loop up to **Decision** (Section 15): the Decision Engine detects opportunities, the Strategy Agent grounds recommendations in evidence, an approver signs off via `POST /api/decisions`, and the immutable `Decision` ledger captures `actionTaken`. Section 22 defines a six-level autonomy scale (0 = full human control, 5 = full autonomy with post-hoc audit), and the tenant's `autonomyLevel` is already stored on `Tenant` and exposed via `/api/autonomy`. Section 24 mandates an immutable `Approval` row before any consequential action.

**What the MVP does not do**: it does not actually *execute* the approved action. `actionTaken` is a free-text string written by the human. There is no campaign-budget change pushed back to Google Ads, no audience activated, no creative published. The architect's hardening review flagged this as the next critical gap:

> *"You have built an autonomous decision system that can never autonomously do anything. That's correct for the MVP — but you cannot ship autonomy levels 3–5 without an execution boundary that lets agents act safely first in simulation, then against sandboxes, then for real. Build the boundary now, while no real spend exists, not after a $10,000 mistake."*

Section 22 already requires `requiresApproval` to gate autonomous actions by autonomy level. What's missing is a **separate, orthogonal axis** — the *execution mode* — that controls whether the action executor actually performs side effects, regardless of whether approval was given. Approval says *"the human consented."* Execution mode says *"the system is allowed to spend money today."* Both must be true for a real action.

## Decision

Introduce an **`ExecutionMode`** configuration with three values, enforced at the **execution boundary** — the single choke point where the platform performs side effects on external systems (ad platforms, e-commerce, CRMs, email/SMS providers).

| Mode          | Behavior                                                                                                                                                                  | Real spend? | Suitable autonomy levels |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| `SIMULATION`  | No real action is performed. The executor records the *intent* as a `Decision` with `actionTaken = "SIMULATED: <action description>"`, emits a `decision_recorded` event, and writes a structured `ExecutionAttempt` row with `mode = SIMULATION` and `outcome = "not_executed_simulated"`. The downstream effect (e.g. expected lift) is *projected* from the causal model, not measured. | No          | 0–5                      |
| `SANDBOX`     | The action is executed against the vendor's **sandbox / test account** (Google Ads test accounts, Shopify dev store, Meta sandbox). Real API calls are made; the vendor confirms the call; no production audience or budget is touched. `ExecutionAttempt.mode = SANDBOX`, `outcome = vendor response`. | No (sandbox currency / dev inventory only) | 0–5                      |
| `LIVE`        | The action is executed against the tenant's **production** vendor accounts. Real budget is committed. **Requires** (a) an `Approval` row (Section 24) **and** (b) tenant `autonomyLevel ≥ 4`. `ExecutionAttempt.mode = LIVE`, `outcome = vendor response`. If either condition is unmet, the executor downgrades to `SIMULATION` and records the rejection. | Yes         | 4–5 (with approval), or any level with explicit human-in-the-loop approval |

### Per-tenant configuration

`ExecutionMode` is set **per tenant** (new column `Tenant.executionMode: String @default("SIMULATION")`, with a check constraint at the adapter level). The default for every new tenant is `SIMULATION` — autonomy must be *earned*, not assumed. Tenants can self-serve upgrade `SIMULATION → SANDBOX` once sandbox credentials are configured; the `SANDBOX → LIVE` transition requires an admin action and an audit-log entry (Section 24).

### Enforcement at the boundary

```ts
// src/lib/domain/ports/ActionExecutor.ts
export interface ActionExecutor {
  execute(action: Action, ctx: ExecutionContext): Promise<ExecutionResult>;
}

export interface ExecutionContext {
  tenantId: string;
  tenantAutonomyLevel: number;   // 0..5
  tenantExecutionMode: ExecutionMode;  // 'SIMULATION' | 'SANDBOX' | 'LIVE'
  approval?: Approval;           // present iff Section 24 approval was granted
  workflowId?: string;
  agentId?: string;
}

// The single boundary implementation (lives in infrastructure):
//   src/lib/infrastructure/execution/ModeAwareActionExecutor.ts
//
//   1. Read ctx.tenantExecutionMode.
//   2. If SIMULATION  -> short-circuit; record ExecutionAttempt with mode=SIMULATION.
//   3. If SANDBOX     -> route to the sandbox vendor adapter (e.g. GoogleAdsSandboxAdapter).
//   4. If LIVE        -> require ctx.approval != null AND ctx.tenantAutonomyLevel >= 4;
//                        if not, downgrade to SIMULATION and record the rejection reason.
//                        if yes, route to the live vendor adapter (e.g. GoogleAdsLiveAdapter).
```

### Same execution API for all three modes

The agent, the workflow engine, and the API all call `actionExecutor.execute(action, ctx)` — they do not branch on mode. This means autonomous behavior can be **developed and tested** against `SIMULATION`, then promoted to `SANDBOX` for vendor-call integration tests, then promoted to `LIVE` for production — **with zero changes to agent code**. The mode is a deployment / tenant config, not an agent behavior.

### Recorded artifacts

Every `execute()` call writes an **`ExecutionAttempt`** row (new model):

```prisma
model ExecutionAttempt {
  id           String   @id @default(cuid())
  tenantId     String
  decisionId   String?           // links back to the Decision (Section 15)
  workflowId   String?
  agentId      String?
  mode         String             // 'SIMULATION' | 'SANDBOX' | 'LIVE'
  actionType   String             // 'scale_campaign' | 'pause_campaign' | 'shift_budget' | 'activate_audience' | ...
  actionPayload String            // JSON: the requested action (budget delta, audience id, creative id, ...)
  vendor       String?            // 'google_ads' | 'shopify' | 'meta' | ... (null in SIMULATION)
  vendorAccountId String?         // sandbox vs live account id
  vendorRequestId String?         // external trace id from the vendor
  outcome      String             // 'executed' | 'not_executed_simulated' | 'rejected_needs_approval' | 'rejected_autonomy_too_low' | 'error'
  vendorResponse String?          // JSON
  errorMessage String?
  attemptedAt  DateTime @default(now())
  completedAt  DateTime?

  @@index([tenantId])
  @@index([tenantId, mode])
  @@index([tenantId, decisionId])
}
```

This row is the Section 24 audit artifact for execution and the Section 26 cost artifact for vendor API spend.

## Consequences

**Positive**

- **Safe autonomy ramp.** Agents can be built, evaluated, and demoed end-to-end in `SIMULATION` (no real spend), then exercised against real vendor APIs in `SANDBOX` (no real spend), then promoted to `LIVE` (real spend, gated). This is the path to autonomy levels 4–5 that Section 22 promises.
- **One execution API.** Agent code, workflow code, and API code do not branch on mode — the mode is a deployment concern. This is the same property ADR-0003 buys for persistence and ADR-0004 buys for LLMs.
- **Auditable.** Every execution attempt — including downgrades and rejections — is a durable `ExecutionAttempt` row. The Section 24 audit log can answer "did the system try to spend money yesterday, and why didn't it?"
- **Defense in depth.** A misconfigured agent, a stale approval, or an autonomy-level regression cannot cause real spend unless `mode = LIVE` **and** `approval != null` **and** `autonomyLevel ≥ 4`. Three independent checks, any one of which downgrades to `SIMULATION`.
- **Tenants can self-serve.** A new tenant starts in `SIMULATION`, promotes to `SANDBOX` after wiring up test accounts, and requests `LIVE` promotion as part of onboarding. No code changes per tenant.

**Negative**

- One more column (`Tenant.executionMode`) and one new table (`ExecutionAttempt`).
- The executor must be the **only** path to vendor write APIs. Any code path that calls a vendor adapter directly (bypassing `ModeAwareActionExecutor`) silently breaks the mode guarantee. Mitigation: vendor adapters live in `src/lib/infrastructure/execution/adapters/` and are only importable from `ModeAwareActionExecutor.ts` (enforced by the same `no-restricted-imports` lint rule proposed in ADR-0003 / ADR-0004).
- `SANDBOX` vendor coverage varies. Google Ads has a usable sandbox; some vendors (e.g. certain email platforms) do not. For vendors without a sandbox, `SANDBOX` falls back to `SIMULATION` with `outcome = "not_executed_no_sandbox_available"`.
- Mode downgrades can confuse an operator who expected a real action. Mitigation: the dashboard surfaces the current `executionMode` prominently, and every downgrade emits an `execution_downgraded` event with the reason.

## Alternatives considered

1. **Gate autonomous execution only on `autonomyLevel` (status quo)** — rejected: autonomy level is a *policy* knob ("should the agent be allowed to act?"), not a *safety* knob ("is the system in a state where acting is safe today?"). The two are orthogonal: a level-5 tenant in `SIMULATION` mode still produces no real spend, which is what you want during the first week of production rollout.
2. **Use a feature flag per action type** — rejected: too granular, too easy to misconfigure, and not tenant-scoped by default. The three-mode triad is coarse enough to reason about and fine enough to cover every real execution scenario.
3. **Run a separate "shadow" stack alongside production** — rejected: doubles infrastructure cost and forces a data-sync problem. The mode-aware executor achieves the same safety property inside one stack.
4. **Make `LIVE` the default for paying tenants** — rejected: inverts the safety posture. The default is `SIMULATION` for every tenant; `LIVE` is a deliberate promotion. Section 24 ("credentials never live in business tables") and Section 22 (autonomy is a ramp, not a switch) both point the same direction.

## Migration plan

1. Add `Tenant.executionMode` (default `"SIMULATION"`) and the `ExecutionAttempt` model to `prisma/schema.prisma`. Run `prisma migrate` / `prisma db push`.
2. Add `src/lib/domain/ports/ActionExecutor.ts` and the `Action` / `ExecutionContext` / `ExecutionResult` types.
3. Implement `src/lib/infrastructure/execution/ModeAwareActionExecutor.ts` with the three-mode dispatch and downgrade logic.
4. Wire existing vendor connectors (currently mock Google Ads + Shopify from `src/lib/connectors/`) into the executor as adapters; the mock connectors become the `SIMULATION` adapters (they already return canned responses).
5. Extend the existing `/api/decisions` POST to call `actionExecutor.execute()` after recording the `Decision` row, instead of just storing the human-typed `actionTaken` string.
6. Add `/api/execution` GET (list attempts) and `/api/execution/mode` GET/POST (read/update tenant mode, admin-gated for `LIVE`).
7. Add a dashboard indicator showing the current tenant mode; surface downgrade reasons.
8. Extend the lint rule (`no-restricted-imports`) so vendor adapters are only importable from `ModeAwareActionExecutor.ts`.
