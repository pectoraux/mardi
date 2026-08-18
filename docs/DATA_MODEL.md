# Data Model

> Marketing Decision Intelligence Platform — Data Architecture & Canonical Domain Model
> References: master prompt Sections 6 (Data Architecture), 7 (Canonical Domain Model), 8 (Event-First Design), 10 (Data Contracts).

## 1. Three data planes

Section 6 specifies three primary data planes — Operational, Analytical, and Semantic — and warns: *"Do not force graph, vector and relational workloads into one datastore."* The frozen architecture called for PostgreSQL + Iceberg + Graph DB + Vector DB. The MVP uses a single SQLite database but **logically separates the three planes** via table partitioning and access patterns (see ADR-0001). The migration path to separate physical stores is mechanical: each plane's tables can be moved to a dedicated database without touching application code, because all access goes through the repository guard.

| Plane          | Frozen store              | SQLite implementation                                                         | Models                                                                                       |
| -------------- | ------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Operational** | PostgreSQL + RLS          | SQLite + `tenant_id` everywhere + repository guard (RLS substitute)           | `Tenant`, `Organization`, `User`, `Policy`, `Brand`, `Product`, `Campaign`, `AdSet`, `Ad`, `Creative`, `Audience`, `Connector`, `SecretRef`, `Workflow`, `WorkflowStep`, `Approval` |
| **Analytical** | Object storage + Iceberg  | `RawRecord` (verbatim source JSON + lineage) + `Interaction` (normalized events) + `Event` (durable replayable) | `RawRecord`, `Interaction`, `Event`                                                          |
| **Semantic**   | Graph DB + Vector DB      | `Edge` table (graph semantics, ADR-0002); Vector deferred — LLM ranking in Strategy Agent | `Edge` (Evidence Graph + Customer/Market graphs)                                            |
| **Intelligence** | (subset of operational)   | Causal estimates, recommendations, decisions, agent runs, tool calls          | `Experiment`, `CausalEstimate`, `Recommendation`, `Decision`, `AgentRun`, `AgentToolCall`, `AuditLog` |

## 2. Canonical domain model

Section 7 lists the minimum coherent domain model. The implementation covers the following (status: ✅ modeled, 🟡 partial, ⏳ deferred):

| Group            | Entities                                                                                                          | Status |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| Tenancy/Identity | Tenant, Organization, User, Policy                                                                                | ✅     |
| Brand/Product    | Brand, Product                                                                                                    | ✅     |
| Market/Geo       | Market, Country, Region                                                                                            | ⏳     |
| Customer         | Person, Account, Customer, Prospect, Audience                                                                     | 🟡 (Customer, Audience; Prospect folded into Customer.segment) |
| Need/JTBD        | Need, Category, CategoryEntryPoint, JobToBeDone, PainPoint, Motivation                                            | ⏳     |
| Message/Creative | Message, Claim, Benefit, ProofPoint, Creative, CreativeVariant                                                    | 🟡 (Creative with hook/promise/cta)                           |
| Channel/Campaign | Channel, Placement, Campaign, AdSet, Ad, Offer                                                                     | 🟡 (Campaign, AdSet, Ad; Channel as enum, no Placement/Offer) |
| Interaction      | Interaction, Impression, Click, View, Visit, Lead, Purchase, Revenue                                              | 🟡 (Interaction.type enum covers all)                        |
| Experiment       | Experiment, Treatment, Control, Exposure, Outcome                                                                  | 🟡 (Experiment; Treatment/Control/Exposure folded into CausalEstimate fields) |
| Model/Prediction | Model, Prediction, Forecast, CausalEstimate, AttributionEstimate                                                  | 🟡 (CausalEstimate; rest deferred)                           |
| Decision         | Recommendation, Decision, Action, Approval                                                                        | ✅     |
| Evidence         | Evidence, Source, Observation, Hypothesis, Conclusion                                                              | 🟡 (Evidence Graph via Edge; Source via RawRecord.connector) |

Every modeled entity has the Section-7 required fields: stable `id` (cuid), `tenantId` (where applicable), `createdAt`, `updatedAt`, `source` information where relevant, `schemaVersion` on `RawRecord` and `Event`, and `lineageId` for traceable records.

## 3. Event-first design (Section 8)

The platform is event-driven. The `Event` table is the canonical, durable, replayable record of every important state change:

```prisma
model Event {
  id            String   @id @default(cuid())
  eventId       String   @unique                  // idempotency key
  tenantId      String
  eventType     String                              // customer_created | impression_created | ...
  entityType    String?
  entityId      String?
  source        String
  occurredAt    DateTime
  ingestedAt    DateTime @default(now())
  schemaVersion Int      @default(1)
  payload       String                              // JSON
  lineageId     String?
}
```

The `Event` table is the SQLite-environment substitute for Kafka. The in-process emitter (`src/lib/event-bus.ts`) **persists** the event (durable) **and** dispatches to in-process subscribers (reactive). Idempotency: `eventId = ${tenantId}:${source}:${uuid}` with a unique constraint. Replay: `replay({ eventType, since }, fn)` re-reads and re-dispatches.

Examples emitted by the current implementation:
`customer_created`, `impression_created`, `click_created`, `purchase_created`, `campaign_performance_snapshot`, `experiment_created`, `experiment_completed`, `recommendation_created`, `decision_recorded`, `learning_recorded`.

## 4. Data contracts (Section 10)

All ingestion flows through:

```
RAW SOURCE  →  SOURCE ADAPTER  →  CANONICAL SEMANTIC MODEL  →  QUALITY VALIDATION  →  TRUSTED DATASET
```

Implemented in `src/lib/connectors/framework.ts`:

1. **RAW SOURCE** — `Connector.extract(ctx, opts)` returns `ExtractedRecord[]` (each with `sourceRecordId`, `entityType`, `payload`).
2. **SOURCE ADAPTER** — `runConnectorSync` persists each record verbatim into `RawRecord` (idempotent on `(connectorId, sourceRecordId)`), with a fresh `lineageId`.
3. **CANONICAL SEMANTIC MODEL** — `Connector.normalize(raw, ctx)` returns `NormalizeOps` (upserts to Campaign/Customer/Interaction/Creative/Ad + events to emit).
4. **QUALITY VALIDATION** — `RawRecord.dataQuality` field (`pending | valid | invalid`); connectors set `valid` after successful normalization. (Automated quality checks are scaffolded; richer validation is future work.)
5. **TRUSTED DATASET** — the canonical tables (`Campaign`, `Customer`, `Interaction`, etc.) and the `Event` table, all carrying `lineageId` for traceability.

Every record retains: `source`, `sourceRecordId`, `tenantId`, `eventTime` (`RawRecord.occurredAt` / `Event.occurredAt`), `ingestion_time` (`RawRecord.ingestedAt` / `Event.ingestedAt`), `schema_version`, `lineage_id`, `data_quality_status`.

## 5. Lineage tracking

`lineageId` (a UUID generated per raw record) is propagated end-to-end:

- `RawRecord.lineageId` (set on ingest)
- `Interaction.lineageId` (set when the connector creates the canonical interaction)
- `Event.lineageId` (set when an event is emitted from the same raw record)
- `Edge.metadata` (lineage reference when linking evidence)

This makes it possible to answer *"which raw source records support this recommendation?"* — traverse `Recommendation --supported_by--> CausalEstimate --produced_by--> Experiment --observed--> Interaction --lineageId--> RawRecord`.

## 6. Raw-data retention policy

Section 10: *"Never destroy raw source records simply because a normalized schema exists."* The `RawRecord` table is append-only — `runConnectorSync` skips records that already exist (idempotent on the unique key) but never deletes them. This guarantees the analytical plane can always be re-derived from RAW if the canonical model changes.

## 7. Schema versioning

`RawRecord.schemaVersion` and `Event.schemaVersion` default to `1`. When a connector's payload shape changes, the connector bumps `schemaVersion`; old records remain queryable. The `Recommendation`, `Decision`, and `AgentRun` models carry `generatedBy` / `modelsUsed` / `promptVersion` fields for the same reason — historical recommendations must remain interpretable as the system evolves.

## 8. Related documents

- `ADR-0001-environment-adaptation.md` — three planes in one SQLite DB
- `ADR-0002-evidence-graph-as-relational-edges.md` — Edge table design
- `CAUSAL_ARCHITECTURE.md` — CausalEstimate schema
- `API.md` — HTTP surface over these models
