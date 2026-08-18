# ADR-0002: Evidence Graph as Relational Edges

- **Status**: Accepted
- **Date**: 2024 (MVP phase 0)
- **Decision owner**: orchestrator
- **Related**: master prompt Section 11 (Evidence Graph); `DATA_MODEL.md`; `ADR-0001-environment-adaptation.md`

## Context

Section 11 mandates a **first-class Evidence Graph**: every recommendation, model conclusion, and causal claim must be linked to evidence, and the platform must answer *"Why did the system make this recommendation?"* with a machine- and human-readable evidence chain. The frozen architecture (Section 3) allocates this to a dedicated **Graph Database** in the Semantic plane, alongside a Vector DB for embeddings.

The MVP environment offers only SQLite (see ADR-0001). There is no Neo4j, Neptune, or other graph database available. Section 11's requirement is non-negotiable: the platform must not let an AI agent present an unsupported causal assertion as fact, and evidence must have provenance.

## Decision

Model the Evidence Graph (and customer/market graphs where they emerge) as a single **relational `Edge` table** with graph semantics preserved via columns rather than via a graph DB:

```prisma
model Edge {
  id         String   @id @default(cuid())
  tenantId   String
  sourceType String   // Recommendation | Experiment | CausalEstimate | Observation | Creative | ...
  sourceId   String
  relation   String   // based_on | supported_by | informed_by | caused | measured_by | produced | ...
  targetType String
  targetId   String
  weight     Float    @default(1)
  metadata   String?  // JSON
  createdAt  DateTime @default(now())

  @@unique([tenantId, sourceType, sourceId, relation, targetType, targetId])
  @@index([tenantId])
  @@index([tenantId, sourceType, sourceId])
  @@index([tenantId, targetType, targetId])
}
```

**Nodes are virtual** — they are not stored as a separate `Node` table. A node is identified by the `(type, id)` pair; the underlying entity lives in its own table (`Recommendation`, `Experiment`, `CausalEstimate`, `Campaign`, etc.). The `kindFor(type)` helper in `src/lib/intelligence/evidence-graph.ts` maps a `sourceType`/`targetType` string to a `kind` enum used by the UI.

**Edges are typed** via the `relation` column. The current vocabulary (extensible):

| Relation         | Meaning                                                              | Example                                                            |
| ---------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `based_on`       | Recommendation derived from an Experiment or Observation            | `Recommendation --based_on--> Experiment`                          |
| `supported_by`   | Recommendation supported by a CausalEstimate                        | `Recommendation --supported_by--> CausalEstimate`                  |
| `informed_by`    | Recommendation informed by CreativeAnalysis (future)                | `Recommendation --informed_by--> Creative`                         |
| `produced`       | Experiment produced a CausalEstimate                                | `Experiment --produced--> CausalEstimate`                          |
| `caused`         | Intervention caused an Outcome (future)                             | `Campaign --caused--> Interaction`                                 |
| `measured_by`    | Outcome measured by an Experiment (future)                          | `Interaction --measured_by--> Experiment`                          |

**Tenant isolation**: the unique constraint and every index include `tenantId`. All access goes through `t.edge.*` (the repository guard), so cross-tenant edge reads are structurally impossible.

**Traversals**: `getEvidenceChain({ type, id })` returns 1-hop neighbors in both directions (outgoing and incoming edges). Deeper traversals can be implemented as iterative 1-hop queries; this is acceptable for MVP recommendation-level evidence chains (typically 1–2 hops).

## Consequences

**Positive**

- Evidence linkage works today, in the MVP environment, with no external dependency.
- Edge creation is idempotent (unique constraint), so `linkEvidence` is safe to retry.
- Tenant isolation is preserved by the same repository guard that protects every other model.
- Querying an evidence chain is a single SQL query (two `findMany` calls on indexed columns), sufficient for MVP-scale graphs.
- Migration to a real graph DB is mechanical: a sync job reads `Edge` rows and writes them as graph relationships. The `Edge` table can remain as the durable source of truth (or be replaced by the graph DB with a back-fill).

**Negative**

- No native graph query language (Cypher / Gremlin) — multi-hop queries require iterative SQL.
- No graph-algorithms library (PageRank, community detection) — would need to be implemented in application code or deferred until a real graph DB is available.
- "Virtual nodes" mean the `Edge` table cannot enforce referential integrity to the underlying entities (the `targetId` is a string, not a foreign key). A future cleanup job could validate that every `(targetType, targetId)` resolves to an existing row.
- Performance degrades on graphs with millions of edges — acceptable for MVP; documented as a scaling constraint.

**Mitigations**

- The `tenantId + sourceType + sourceId` and `tenantId + targetType + targetId` indexes make 1-hop traversals O(log n).
- The `@@unique` constraint on the full 5-tuple makes `linkEvidence` idempotent.
- `getFullGraph(limit)` caps at 500 edges by default to protect the UI.

## Alternatives considered

1. **JSON adjacency list on each entity** (e.g. `Recommendation.evidenceIds: string[]`) — rejected: loses relation typing, makes bidirectional traversal impossible, no idempotency.
2. **Dedicated `Node` + `Edge` tables with foreign keys to typed entity tables** — rejected: would require either a polymorphic FK (not supported by SQLite/Prisma cleanly) or one edge table per entity pair (explodes the schema).
3. **Defer the Evidence Graph until a real graph DB is available** — rejected: Section 11 is non-negotiable, and the Decision Engine's invariant *"a recommendation without evidence is incomplete"* (Section 15) cannot be enforced without it.
4. **Use a JSON column with a GIN index** — rejected: SQLite has no GIN index; queryability would be poor.

## Migration path

- Add a graph-DB sync worker that mirrors `Edge` rows to Neo4j/Neptune.
- Optionally add a `Node` table for cache-rich metadata (labels, kinds, denormalized summaries) — the current `labelFor` / `kindFor` helpers can be replaced with a `Node` lookup.
- For very large graphs, partition `Edge` by `tenantId` (already indexed) or by `sourceType`.
