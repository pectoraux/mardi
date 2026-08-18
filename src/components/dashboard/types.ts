// Shared dashboard types + tiny fetch helper.

export interface Tenant {
  slug: string
  name: string
  plan: string
  region: string
  autonomyLevel: number
  learningOptIn: boolean
}

export interface DashboardData {
  tenant: { slug: string; roles: string[]; region: string; autonomyLevel: number }
  brands: Array<{ id: string; name: string; category: string | null; productCount: number }>
  metrics: {
    totalSpend: number
    totalRevenue: number
    avgCausalLift: number
    campaignCount: number
    customerCount: number
    experimentCount: number
    causalEstimateCount: number
    recommendationCount: number
    decisionCount: number
    eventCount: number
    rawRecordCount: number
    connectorCount: number
  }
  channels: Array<{ channel: string; spend: number; campaigns: number }>
  segments: Array<{ segment: string; count: number; avgLtv: number }>
  recentEvents: Array<{ id: string; type: string; source: string; occurredAt: string; entityId: string | null }>
  connectors: Array<{
    id: string; type: string; name: string; status: string
    lastSyncAt: string | null; recordsPulled: number; lastError: string | null
  }>
  rawRecords: Array<{
    id: string; source: string; entityType: string; sourceRecordId: string
    dataQuality: string; ingestedAt: string; lineageId: string
  }>
}

export interface EventRow {
  id: string; eventId: string; type: string; source: string
  entityType: string | null; entityId: string | null
  occurredAt: string; ingestedAt: string; schemaVersion: number
  lineageId: string | null; properties: Record<string, unknown>
}

export interface EvidenceNodeT {
  type: string; id: string; label: string; kind: string
}
export interface EvidenceEdgeT {
  source: EvidenceNodeT; relation: string; target: EvidenceNodeT; weight: number
}
export interface EvidenceGraph {
  nodes: EvidenceNodeT[]; edges: EvidenceEdgeT[]
}

export interface ExperimentT {
  id: string; name: string; hypothesis: string; objective: string
  primaryMetric: string; methodology: string; status: string
  decision: string | null; learning: string | null
  durationDays: number; sampleSize: number
  startDate: string | null; endDate: string | null
  causalEstimates: unknown[]
}

export interface OpportunityT {
  type: string; campaignId?: string; description: string
  expectedIncrementalRevenue: number; expectedIncrementalProfit: number
  confidence: number; uncertainty: { low: number; high: number }
  evidence: Array<{ type: string; id: string; summary: string }>
  risks: string[]; constraints: string[]; nextBestExperiment: string
}

export interface RecommendationT {
  id: string; opportunity: string; recommendation: string
  expectedIncrementalProfit: number; expectedIncrementalRevenue: number
  confidence: number; uncertainty: { low: number; high: number } | null
  risks: string[]; constraints: string[]; nextBestExperiment: string | null
  status: string; generatedBy: string; createdAt: string
}

export interface DecisionT {
  id: string; objective: string; recommendation: string
  evidence: Array<{ relation: string; targetType: string; targetId: string }>
  modelsUsed: string[]; assumptions: string[]
  expectedOutcome: Record<string, unknown> | null
  actualOutcome: Record<string, unknown> | null
  confidence: number; actionTaken: string | null
  learning: string | null; status: string; createdAt: string
  recommendationId: string | null; approvals: unknown[]
}

export interface AgentResultT {
  runId: string
  answer: string
  structured?: {
    summary: string
    observed: string[]
    inferred: string[]
    predicted: string[]
    recommended: string[]
    evidence: Array<{ type: string; id: string; summary: string }>
    uncertainty: string
    nextBestExperiment: string
  }
  toolCalls: Array<{ tool: string; ok: boolean; outputPreview: string }>
  tokens: { input: number; output: number }
  latencyMs: number
}

export interface AutonomyT {
  autonomyLevel: number; region: string; roles: string[]; environment: string
  policies: Array<{
    id: string; name: string; maxSpendChangePct: number
    allowedChannels: string[]; allowedActions: string[]
    requiresApproval: boolean; riskThreshold: number; operatingHours: string
  }>
  levels: Array<{ level: number; label: string }>
}

const API_BASE = ''

export async function apiFetch<T>(
  path: string,
  tenant: string,
  opts?: { method?: string; body?: unknown }
): Promise<T> {
  const url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}tenant=${encodeURIComponent(tenant)}`
  const res = await fetch(url, {
    method: opts?.method ?? 'GET',
    headers: opts?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json() as Promise<T>
}

export function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
