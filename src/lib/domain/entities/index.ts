// =============================================================================
// Domain entities — pure TypeScript types, no infrastructure imports.
// =============================================================================
// These are the canonical domain types (Section 7). The domain layer, the
// repository ports, and the application services all depend ONLY on these
// types. They never import Prisma, z-ai, or any infrastructure package.

// --- Tenancy & identity ---
export interface Tenant {
  id: string
  slug: string
  name: string
  plan: 'standard' | 'enterprise'
  region: string
  autonomyLevel: number
  isolationMode: 'pooled' | 'silo'
  learningOptIn: boolean
  executionMode: 'SIMULATION' | 'SANDBOX' | 'LIVE'
  createdAt: Date
  updatedAt: Date
}

export interface User {
  id: string
  tenantId: string | null
  email: string
  name: string
  roles: string
  isDemo: boolean
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface WaitlistEntry {
  id: string
  email: string
  name: string
  requestedRole: string
  tenantSlug: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewedBy: string | null
  reviewedAt: Date | null
  createdUserId: string | null
  createdAt: Date
  updatedAt: Date
}

// --- Brand / product / market ---
export interface Brand {
  id: string
  tenantId: string
  name: string
  category: string | null
  description: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Product {
  id: string
  tenantId: string
  brandId: string
  name: string
  price: number
  currency: string
  createdAt: Date
  updatedAt: Date
}

// --- Customer / audience ---
export interface Customer {
  id: string
  tenantId: string
  externalId: string | null
  email: string | null
  name: string | null
  segment: string | null
  ltv: number
  createdAt: Date
  updatedAt: Date
}

export interface Audience {
  id: string
  tenantId: string
  name: string
  description: string | null
  size: number
  criteria: string
  createdAt: Date
  updatedAt: Date
}

// --- Creative ---
export interface Creative {
  id: string
  tenantId: string
  brandId: string | null
  name: string
  format: string
  channel: string | null
  hook: string | null
  promise: string | null
  cta: string | null
  createdAt: Date
  updatedAt: Date
}

// --- Campaign / adset / ad ---
export interface Campaign {
  id: string
  tenantId: string
  brandId: string | null
  externalId: string | null
  name: string
  channel: string
  status: string
  objective: string | null
  budget: number
  spent: number
  startDate: Date | null
  endDate: Date | null
  createdAt: Date
  updatedAt: Date
}

// --- Interaction ---
export interface Interaction {
  id: string
  tenantId: string
  customerId: string | null
  adId: string | null
  type: string
  value: number
  occurredAt: Date
  source: string | null
  lineageId: string | null
  createdAt: Date
}

// --- Connector ---
export interface Connector {
  id: string
  tenantId: string
  type: string
  name: string
  status: string
  lastSyncAt: Date | null
  lastSyncStatus: string | null
  lastError: string | null
  recordsPulled: number
  config: string
  createdAt: Date
  updatedAt: Date
}

export interface RawRecord {
  id: string
  tenantId: string
  connectorId: string
  source: string
  sourceRecordId: string
  entityType: string
  payload: string
  schemaVersion: number
  dataQuality: string
  ingestedAt: Date
  occurredAt: Date | null
  lineageId: string
}

// --- Events ---
export interface CanonicalEvent {
  id: string
  eventId: string
  tenantId: string
  eventType: string
  entityType: string | null
  entityId: string | null
  source: string
  occurredAt: Date
  ingestedAt: Date
  schemaVersion: number
  payload: string
  lineageId: string | null
}

// --- Evidence graph ---
export interface Edge {
  id: string
  tenantId: string
  sourceType: string
  sourceId: string
  relation: string
  targetType: string
  targetId: string
  weight: number
  metadata: string | null
  createdAt: Date
}

// --- Experiment & causal ---
export interface Experiment {
  id: string
  tenantId: string
  campaignId: string | null
  name: string
  hypothesis: string
  objective: string
  primaryMetric: string
  secondaryMetrics: string | null
  guardrailMetrics: string | null
  methodology: string
  status: string
  sampleSize: number
  durationDays: number
  startDate: Date | null
  endDate: Date | null
  decision: string | null
  learning: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CausalEstimate {
  id: string
  tenantId: string
  experimentId: string | null
  campaignId: string | null
  metric: string
  treatment: string
  control: string
  methodology: string
  effectSize: number
  effectSizePct: number
  uncertaintyLow: number
  uncertaintyHigh: number
  confidence: number
  population: string | null
  observationWindowDays: number
  assumptions: string | null
  modelVersion: string
  sourceData: string | null
  createdAt: Date
}

// --- Decision engine ---
export interface Recommendation {
  id: string
  tenantId: string
  opportunity: string
  recommendation: string
  expectedIncrementalProfit: number
  expectedIncrementalRevenue: number
  confidence: number
  uncertainty: string | null
  risks: string | null
  constraints: string | null
  nextBestExperiment: string | null
  status: string
  generatedBy: string
  // AI versioning (Section 26 + hardening pass)
  aiProvider: string | null
  aiModel: string | null
  aiModelVersion: string | null
  aiPromptVersion: string | null
  aiToolSchemaVersion: string | null
  aiAgentVersion: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Decision {
  id: string
  tenantId: string
  recommendationId: string | null
  objective: string
  recommendation: string
  evidence: string
  modelsUsed: string | null
  assumptions: string | null
  expectedOutcome: string | null
  confidence: number
  approverId: string | null
  actionTaken: string | null
  actualOutcome: string | null
  learning: string | null
  status: string
  executionMode: string | null
  createdAt: Date
  updatedAt: Date
}

// --- Agent runs ---
export interface AgentRun {
  id: string
  tenantId: string
  agentName: string
  prompt: string
  output: string | null
  modelProvider: string
  modelName: string
  promptVersion: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  status: string
  error: string | null
  createdAt: Date
}

// --- Capital ledger (Zero-Capital Growth Engine) ---
export interface CapitalLedgerEntry {
  id: string
  tenantId: string
  type: 'AVAILABLE' | 'COMMITTED' | 'SPENT' | 'EXPECTED_RETURN' | 'REALIZED_RETURN' | 'REINVESTMENT'
  amount: number
  currency: string
  source: string
  referenceType: string | null
  referenceId: string | null
  description: string | null
  createdAt: Date
}

export interface CapitalSummary {
  available: number
  committed: number
  spent: number
  expectedReturn: number
  realizedReturn: number
  reinvestmentPool: number
  currency: string
}
