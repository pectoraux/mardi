# Causal Architecture

> Marketing Decision Intelligence Platform — Causal Intelligence Service
> References: master prompt Section 12 (Causal Intelligence Service), Section 13 (Experiment Service), Section 15 (Decision Engine), Section 35 (AI Safety).

## 1. Dedicated causal boundary

Section 12 mandates a dedicated **Causal Intelligence** boundary that owns: controlled experiments, randomized experiments, holdouts, geo experiments, incrementality analysis, marketing mix modeling, attribution estimates, uplift modeling, causal graphs, and counterfactual estimates.

In the MVP, this boundary is implemented by `src/lib/intelligence/experiment.ts` and the `CausalEstimate` Prisma model. The Decision Engine (`src/lib/intelligence/decision-engine.ts`) consumes **causal estimates — never raw correlations** — when ranking opportunities. The Strategy Agent's `estimate_incrementality` tool returns causal estimates grouped by campaign; the agent's system prompt forbids inventing causal claims.

## 2. CausalEstimate schema

Every causal estimate persisted in the platform carries the full Section 12 attribute set:

```prisma
model CausalEstimate {
  id              String   @id @default(cuid())
  tenantId        String
  experimentId    String?
  campaignId      String?
  metric          String     // revenue | conversions | roas | ...
  treatment       String     // treatment_arm description
  control         String     // control_arm description
  methodology     String     // ab_test | holdout | geo_experiment | mmm | uplift | did
  effectSize      Float      // absolute incremental lift
  effectSizePct   Float      // incremental lift (%)
  uncertaintyLow  Float      // 95% CI lower bound (relative)
  uncertaintyHigh Float      // 95% CI upper bound (relative)
  confidence      Float      // 0..1
  population      String?    // JSON: who was studied
  observationWindowDays Int  // 14 by default
  assumptions     String?    // JSON: parallel trends, no interference, etc.
  modelVersion    String     // 'ab-test-v1' | 'mmm-v3' | ...
  sourceData      String?    // JSON: references to RawRecord / Event ids
  createdAt       DateTime @default(now())
}
```

Section 12 mapping:

| Section 12 attribute      | Field                              |
| ------------------------- | ---------------------------------- |
| treatment                 | `treatment`                        |
| control                   | `control`                          |
| metric                    | `metric`                           |
| methodology               | `methodology`                      |
| effect size               | `effectSize`, `effectSizePct`      |
| uncertainty interval      | `uncertaintyLow`, `uncertaintyHigh`|
| confidence/evidence score | `confidence`                       |
| population                | `population` (JSON)                |
| observation window        | `observationWindowDays`            |
| assumptions               | `assumptions` (JSON)               |
| source data               | `sourceData` (JSON)                |
| model version             | `modelVersion`                     |

Every field is mandatory on the create path (`completeExperiment` fills them all), so a `CausalEstimate` row is always self-describing — a downstream consumer can interpret it without reading the experiment.

## 3. Correlation vs causation

Section 12: *"The architecture must distinguish CORRELATION from CAUSATION. Do not let generic analytics or an LLM substitute for causal inference."*

The implementation enforces this in three places:

1. **Schema** — the `methodology` field is a closed enum (`ab_test`, `holdout`, `geo_experiment`, `mmm`, `uplift`, `did`). A row without a methodology cannot exist (no default of "correlation"). An `Interaction` row (a raw correlation) is **not** a `CausalEstimate` and cannot be substituted for one.
2. **Decision Engine** — `detectOpportunities` reads from `getCausalEstimatesByCampaign()`, which returns only `CausalEstimate` rows. It never reads `Interaction` rows directly when ranking opportunities.
3. **Strategy Agent** — the system prompt forbids causal claims unless `estimate_incrementality` was called. The output JSON shape requires causal claims to be bucketed under `observed` (measured) or `inferred` (model-derived), never presented as facts without an evidence reference.

## 4. Experiment → CausalEstimate lifecycle

`src/lib/intelligence/experiment.ts`:

1. `createExperiment(input)` — creates an `Experiment` row (hypothesis, objective, primary metric, methodology, duration, sample size, population, guardrail metrics). Emits `experiment_created`.
2. `completeExperiment(experimentId, result)` — marks the experiment `analyzed`, sets `decision` (ship | iterate | kill) and `learning`, then creates the `CausalEstimate` row with the full Section 12 attribute set. Links `Experiment --produced--> CausalEstimate` in the Evidence Graph. Emits `experiment_completed`.

Section 13 compliance: every experiment is durable organizational knowledge — once `analyzed`, it never disappears. The `learning` field is the institutional-memory payload.

## 5. Methodologies

The MVP supports the methodology enum but only `ab_test` is exercised by `completeExperiment`'s default `modelVersion: 'ab-test-v1'`. The other methodologies (`holdout`, `geo_experiment`, `mmm`, `uplift`, `did`) have schema support and clear field semantics, so a future MMM engine can write `CausalEstimate` rows without schema changes — it just sets `methodology: 'mmm'` and `modelVersion: 'mmm-v1'` and fills the same fields.

## 6. Uncertainty is first-class

Section 16: *"The system must model uncertainty, not pretend that point estimates are exact. Prefer EXPECTED EFFECT + UNCERTAINTY over SINGLE ROI NUMBER."*

The Decision Engine's `Opportunity` shape carries both `confidence` (a 0..1 scalar) and `uncertainty: { low, high }` (an interval). The Strategy Agent's output JSON requires an `uncertainty` string and the `evidence` array references the underlying `CausalEstimate` with its CI. The UI surfaces these as ranges, never as point estimates.

## 7. Evidence linkage

`completeExperiment` calls `linkEvidence({ type: 'Experiment', id }, 'produced', { type: 'CausalEstimate', id })`. The Decision Engine's `recordRecommendation` calls `linkEvidence({ type: 'Recommendation', id }, 'supported_by', { type: 'CausalEstimate', id })` (or `based_on` for non-causal evidence). This means:

- Every `Recommendation` can be traced through the Evidence Graph to the `CausalEstimate`(s) that support it, and from there to the `Experiment` that produced them, and from there (via `lineageId`) to the raw source records.
- The Strategy Agent's `get_evidence` tool traverses this chain and returns it as a structured `nodes` + `edges` payload.

## 8. Decision Engine consumption

`detectOpportunities(opts)`:

1. Loads all campaigns for the active tenant.
2. Loads all `CausalEstimate` rows via `getCausalEstimatesByCampaign()`.
3. For each campaign with at least one estimate, picks the highest-`confidence` estimate as primary evidence.
4. If `effectSizePct > 0.1` and `confidence >= minConfidence` (default 0.5), produces a `scale` opportunity with expected incremental revenue = `spent * effectSizePct * 1.5` (rough extrapolation, flagged in code as a heuristic) and incremental profit ≈ 35% of incremental revenue.
5. If `effectSizePct <= 0`, produces a `pause`/`pivot` opportunity.
6. Always proposes at least one `experiment` opportunity (the next-best experiment to reduce uncertainty) — Section 15 requires `nextBestExperiment` on every recommendation.

The extrapolation factor (1.5×) and profit margin (35%) are explicitly heuristic — Section 16 requires modeling uncertainty, and the Opportunity's `uncertainty: { low, high }` carries the underlying `CausalEstimate`'s CI rather than a fabricated range. A future Optimization Engine (Section 16) will replace these heuristics with a proper saturation-curve model.

## 9. Counterfactuals and digital twin (Section 17)

Section 17 (Marketing Digital Twin) and counterfactual estimation are explicitly **future** — the schema supports them (`methodology: 'did'`, `assumptions` JSON for parallel-trends / no-interference), but no estimation engine is shipped in the MVP.

## 10. Related documents

- `AI_ARCHITECTURE.md` — `estimate_incrementality` tool, agent safety rules
- `DATA_MODEL.md` — `CausalEstimate` in the canonical model
- `ARCHITECTURE.md` — closed-loop diagram
