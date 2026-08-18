// =============================================================================
// Infrastructure Port Interfaces — the complete provider-neutral abstraction
// =============================================================================
// Phase A of the complete frozen architecture implementation.
// Every infrastructure capability is represented by a port. The domain and
// application layers depend ONLY on these ports. Concrete adapters live in
// src/lib/infrastructure/* and are wired by the composition root.
//
// Bootstrap adapters (Postgres, in-process, pgvector, relational graph, R2,
// local model) remain available. Production adapters (Kafka, Temporal,
// dedicated vector DB, Neo4j, S3, OpenAI/Anthropic, Stripe) are added behind
// the SAME interfaces. The application never knows which adapter is active.
//
// Reference: Section 2 (Provider-Neutral Infrastructure) of the frozen arch.

import type { TenantContext } from '../../tenant-context'
import type { CanonicalEvent } from '../../domain/entities'

// ---------------------------------------------------------------------------
// 1. EventBus — durable, replayable, tenant-aware event backbone (Section 4)
// ---------------------------------------------------------------------------
export interface EventBusPort {
  emit(ctx: TenantContext, event: {
    eventType: string
    source: string
    entityType?: string
    entityId?: string
    occurredAt?: Date
    properties: Record<string, unknown>
    lineageId?: string
  }): Promise<CanonicalEvent>

  subscribe(eventType: string, fn: (e: CanonicalEvent) => void | Promise<void>): () => void

  /** Replay events for a tenant (used by backfill / recovery / new consumers). */
  replay(ctx: TenantContext, opts?: {
    eventType?: string
    since?: Date
    limit?: number
  }): AsyncIterable<CanonicalEvent>
}

// ---------------------------------------------------------------------------
// 2. ObjectStore — raw data retention, creative assets, lakehouse (Section 6)
// ---------------------------------------------------------------------------
export interface ObjectStorePort {
  put(ctx: TenantContext, key: string, data: Buffer | string, opts?: {
    contentType?: string
    metadata?: Record<string, string>
  }): Promise<{ key: string; url: string; size: number }>

  get(ctx: TenantContext, key: string): Promise<Buffer | null>

  delete(ctx: TenantContext, key: string): Promise<void>

  list(ctx: TenantContext, prefix: string, opts?: { limit?: number }): Promise<Array<{ key: string; size: number; lastModified: Date }>>

  /** Get a signed URL for temporary access (e.g. for uploads/downloads). */
  signUrl(ctx: TenantContext, key: string, opts?: { expiresInSeconds?: number; method?: 'GET' | 'PUT' }): Promise<string>
}

// ---------------------------------------------------------------------------
// 3. VectorStore — semantic retrieval, embeddings (Section 23)
// ---------------------------------------------------------------------------
export interface VectorStorePort {
  upsert(ctx: TenantContext, point: {
    id: string
    vector: number[]
    metadata?: Record<string, unknown>
  }): Promise<void>

  upsertBatch(ctx: TenantContext, points: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>): Promise<void>

  search(ctx: TenantContext, query: number[], opts?: {
    topK?: number
    filter?: Record<string, unknown>
    minScore?: number
  }): Promise<Array<{ id: string; score: number; metadata?: Record<string, unknown> }>>

  delete(ctx: TenantContext, id: string): Promise<void>

  /** Tenant-scoped namespace isolation. */
  ensureNamespace(ctx: TenantContext): Promise<void>
}

// ---------------------------------------------------------------------------
// 4. GraphStore — evidence graph, customer graph, market graph (Section 12)
// ---------------------------------------------------------------------------
export interface GraphStorePort {
  addNode(ctx: TenantContext, node: {
    type: string
    id: string
    properties?: Record<string, unknown>
  }): Promise<void>

  addEdge(ctx: TenantContext, edge: {
    sourceType: string
    sourceId: string
    relation: string
    targetType: string
    targetId: string
    weight?: number
    properties?: Record<string, unknown>
  }): Promise<void>

  /** Traverse from a node — returns neighbors within N hops. */
  traverse(ctx: TenantContext, start: { type: string; id: string }, opts?: {
    maxDepth?: number
    relationFilter?: string[]
    limit?: number
  }): Promise<{
    nodes: Array<{ type: string; id: string; properties?: Record<string, unknown> }>
    edges: Array<{ sourceType: string; sourceId: string; relation: string; targetType: string; targetId: string; weight: number }>
  }>

  /** Find the evidence chain for a node (why does the system believe this?). */
  getEvidenceChain(ctx: TenantContext, node: { type: string; id: string }): Promise<{
    nodes: Array<{ type: string; id: string; properties?: Record<string, unknown> }>
    edges: Array<{ sourceType: string; sourceId: string; relation: string; targetType: string; targetId: string; weight: number }>
  }>
}

// ---------------------------------------------------------------------------
// 5. WorkflowEngine — durable execution (Section 5)
// ---------------------------------------------------------------------------
export interface WorkflowEnginePort {
  start<T = unknown>(ctx: TenantContext, workflow: {
    type: string
    input: Record<string, unknown>
    version?: string
  }): Promise<{ workflowId: string }>

  getStatus(ctx: TenantContext, workflowId: string): Promise<{
    status: 'pending' | 'running' | 'completed' | 'failed' | 'paused'
    currentStep?: string
    output?: T
    error?: string
  }>

  /** Pause a workflow (e.g. waiting for human approval). */
  pause(ctx: TenantContext, workflowId: string): Promise<void>

  /** Resume a paused workflow (e.g. after approval). */
  resume(ctx: TenantContext, workflowId: string, signal?: Record<string, unknown>): Promise<void>

  /** Cancel a running workflow. */
  cancel(ctx: TenantContext, workflowId: string): Promise<void>
}

// ---------------------------------------------------------------------------
// 6. Cache — tenant-scoped caching (Section 2)
// ---------------------------------------------------------------------------
export interface CachePort {
  get<T = unknown>(ctx: TenantContext, key: string): Promise<T | null>
  set<T = unknown>(ctx: TenantContext, key: string, value: T, opts?: { ttlSeconds?: number }): Promise<void>
  delete(ctx: TenantContext, key: string): Promise<void>
  invalidatePattern(ctx: TenantContext, pattern: string): Promise<void>
}

// ---------------------------------------------------------------------------
// 7. Search — full-text + semantic search (Section 23)
// ---------------------------------------------------------------------------
export interface SearchPort {
  index(ctx: TenantContext, doc: {
    id: string
    fields: Record<string, string>
    metadata?: Record<string, unknown>
  }): Promise<void>

  search(ctx: TenantContext, query: string, opts?: {
    limit?: number
    filter?: Record<string, unknown>
    fields?: string[]
  }): Promise<Array<{ id: string; score: number; fields: Record<string, string>; metadata?: Record<string, unknown> }>>

  delete(ctx: TenantContext, id: string): Promise<void>
}

// ---------------------------------------------------------------------------
// 8. LLMProvider (already exists, re-exported for completeness)
// ---------------------------------------------------------------------------
export interface LLMProvider {
  readonly name: string
  readonly model: string
  readonly modelVersion: string
  complete(req: LLMRequest): Promise<LLMResult>
}

export interface LLMRequest {
  systemPrompt: string
  userMessage: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  json?: boolean
  thinking?: boolean
}

export interface LLMResult {
  content: string
  parsed?: unknown
  inputTokens: number
  outputTokens: number
  latencyMs: number
  provider: string
  model: string
  modelVersion: string
  fellBack?: boolean
}

// ---------------------------------------------------------------------------
// 9. EmbeddingProvider — vector embeddings for semantic retrieval (Section 23)
// ---------------------------------------------------------------------------
export interface EmbeddingProvider {
  readonly name: string
  readonly model: string
  readonly dimensions: number

  embed(ctx: TenantContext, text: string): Promise<{ vector: number[]; tokenCount: number }>
  embedBatch(ctx: TenantContext, texts: string[]): Promise<{ vectors: number[][]; tokenCount: number }>
}

// ---------------------------------------------------------------------------
// 10. ModelRuntime — ML model execution (predictive, propensity, uplift)
// ---------------------------------------------------------------------------
export interface ModelRuntimePort {
  predict(ctx: TenantContext, modelId: string, input: Record<string, unknown>): Promise<{
    prediction: unknown
    confidence: number
    modelVersion: string
    latencyMs: number
  }>

  /** Register a model in the registry (Section 24). */
  register(ctx: TenantContext, model: {
    id: string
    name: string
    provider: string
    version: string
    type: 'predictive' | 'propensity' | 'uplift' | 'forecast' | 'causal' | 'llm' | 'embedding'
    status: 'active' | 'candidate' | 'deprecated' | 'rolled_back'
    costPerInvocation?: number
    avgLatencyMs?: number
  }): Promise<void>
}

// ---------------------------------------------------------------------------
// 11. ExperimentRunner — controlled experiment execution (Section 16)
// ---------------------------------------------------------------------------
export interface ExperimentRunnerPort {
  /** Assign a user/session to a treatment arm (tenant-scoped). */
  assign(ctx: TenantContext, experimentId: string, subjectId: string): Promise<{
    arm: string
    variant: string
    exposureId: string
  }>

  /** Record an exposure event. */
  recordExposure(ctx: TenantContext, experimentId: string, subjectId: string, arm: string): Promise<void>

  /** Compute the causal estimate for a completed experiment. */
  analyze(ctx: TenantContext, experimentId: string): Promise<{
    effectSize: number
    effectSizePct: number
    uncertaintyLow: number
    uncertaintyHigh: number
    confidence: number
    methodology: string
    sampleSize: number
  }>
}

// ---------------------------------------------------------------------------
// 12. CausalEngine — causal inference methods (Section 13)
// ---------------------------------------------------------------------------
export interface CausalEnginePort {
  /** Run a difference-in-differences analysis. */
  differenceInDifferences(ctx: TenantContext, input: {
    treatment: Array<{ time: string; value: number }>
    control: Array<{ time: string; value: number }>
    treatmentTime: string
  }): Promise<CausalResult>

  /** Run a geo experiment analysis. */
  geoExperiment(ctx: TenantContext, input: {
    treatmentGeos: Array<{ geo: string; value: number }>
    controlGeos: Array<{ geo: string; value: number }>
    metric: string
  }): Promise<CausalResult>

  /** Run a causal impact analysis (synthetic control). */
  causalImpact(ctx: TenantContext, input: {
    series: Array<{ time: string; value: number }>
    interventionTime: string
    controlSeries?: Array<{ time: string; value: number }>
  }): Promise<CausalResult>

  /** Run an uplift model analysis. */
  uplift(ctx: TenantContext, input: {
    treated: Array<{ outcome: number; features: Record<string, unknown> }>
    control: Array<{ outcome: number; features: Record<string, unknown> }>
  }): Promise<CausalResult>

  /** Run an MMM (Marketing Mix Model) — Section 14. */
  mmm(ctx: TenantContext, input: {
    channels: Array<{ name: string; spend: number[]; impressions: number[] }>
    outcome: number[]
    timePoints: number
    seasonality?: boolean
    trend?: boolean
  }): Promise<MMMResult>
}

export interface CausalResult {
  effectSize: number
  effectSizePct: number
  uncertaintyLow: number
  uncertaintyHigh: number
  confidence: number
  methodology: string
  assumptions: string[]
  modelVersion: string
  // Distinguish OBSERVED / CORRELATED / CAUSAL / PREDICTED / RECOMMENDED
  evidenceType: 'OBSERVED' | 'CORRELATED' | 'CAUSAL' | 'PREDICTED' | 'RECOMMENDED'
}

export interface MMMResult extends CausalResult {
  channelContributions: Array<{
    channel: string
    contribution: number
    roi: number
    marginalRoi: number
    saturation: number
    carryover: number
  }>
  backtestAccuracy?: number
}

// ---------------------------------------------------------------------------
// 13. ExecutionProvider — external action execution (Section 26)
// ---------------------------------------------------------------------------
export interface ExecutionProviderPort {
  /** Execute an external action through the policy + approval pipeline. */
  execute(ctx: TenantContext, action: {
    type: 'ad_platform' | 'crm' | 'email' | 'content' | 'commerce' | 'audience' | 'web' | 'experiment'
    provider: string // google_ads | meta | salesforce | hubspot | shopify | ...
    operation: string // pause_campaign | publish_content | send_email | ...
    params: Record<string, unknown>
    cost?: number
  }): Promise<{
    result: unknown
    mode: 'SIMULATION' | 'SANDBOX' | 'LIVE'
    simulated: boolean
    executionId: string
  }>
}

// ---------------------------------------------------------------------------
// 14. PaymentProvider — revenue verification (Section 28)
// ---------------------------------------------------------------------------
export interface PaymentProviderPort {
  /** Verify a payment against the provider's API (Stripe, PayPal, etc.). */
  verifyPayment(ctx: TenantContext, paymentReference: string, provider: string): Promise<{
    verified: boolean
    amount: number
    currency: string
    paidAt: Date
    fees: number
    metadata?: Record<string, unknown>
  }>

  /** Create a checkout session / payment intent. */
  createPayment(ctx: TenantContext, input: {
    amount: number
    currency: string
    description: string
    customerId?: string
  }): Promise<{ paymentReference: string; checkoutUrl?: string }>
}

// ---------------------------------------------------------------------------
// 15. EmailProvider — outreach / notification email (Section 26)
// ---------------------------------------------------------------------------
export interface EmailProviderPort {
  send(ctx: TenantContext, email: {
    to: string
    from?: string
    subject: string
    body: string
    html?: string
    replyTo?: string
    metadata?: Record<string, unknown>
  }): Promise<{ messageId: string; provider: string; mode: 'SIMULATION' | 'SANDBOX' | 'LIVE' }>
}

// ---------------------------------------------------------------------------
// 16. ObservabilityProvider — OpenTelemetry-compatible (Section 35)
// ---------------------------------------------------------------------------
export interface ObservabilityProviderPort {
  metric(ctx: TenantContext, name: string, value: number, opts?: {
    unit?: string
    tags?: Record<string, string>
  }): void

  increment(ctx: TenantContext, name: string, opts?: {
    tags?: Record<string, string>
  }): void

  histogram(ctx: TenantContext, name: string, value: number, opts?: {
    unit?: string
    tags?: Record<string, string>
  }): void

  span<T>(ctx: TenantContext, name: string, fn: () => Promise<T>, opts?: {
    tags?: Record<string, string>
  }): Promise<T>

  log(ctx: TenantContext, level: 'debug' | 'info' | 'warn' | 'error', message: string, opts?: {
    tags?: Record<string, string>
    data?: Record<string, unknown>
  }): void
}
