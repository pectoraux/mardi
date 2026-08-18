// =============================================================================
// Billing & Usage (Section 29)
// =============================================================================
// Plans: Free, Growth, Pro, Enterprise.
// Tracks: AI token cost, compute cost, storage cost, connector usage,
// execution usage. Billing providers are abstracted (PaymentProviderPort).

export type Plan = 'free' | 'growth' | 'pro' | 'enterprise'

export interface UsageEntry {
  tenantId: string
  type: 'ai_tokens' | 'compute' | 'storage' | 'connector_sync' | 'execution' | 'experiment'
  amount: number
  unit: string
  cost: number
  metadata?: Record<string, unknown>
  recordedAt: Date
}

export interface UsageSummary {
  tenantId: string
  period: { start: Date; end: Date }
  totalCost: number
  byType: Record<string, { amount: number; cost: number }>
}

export interface BillingService {
  recordUsage(entry: Omit<UsageEntry, 'recordedAt'>): Promise<void>
  getUsageSummary(tenantId: string, period: { start: Date; end: Date }): Promise<UsageSummary>
  getPlan(tenantId: string): Plan
  getEntitlements(tenantId: string): PlanEntitlements
}

export interface PlanEntitlements {
  plan: Plan
  maxTenants: number
  maxUsers: number
  maxConnectors: number
  maxExperiments: number
  maxAgentRuns: number
  maxAiTokensPerMonth: number
  features: string[]
}

const PLAN_ENTITLEMENTS: Record<Plan, PlanEntitlements> = {
  free: {
    plan: 'free', maxTenants: 1, maxUsers: 3, maxConnectors: 2, maxExperiments: 5,
    maxAgentRuns: 50, maxAiTokensPerMonth: 100_000,
    features: ['analysis', 'limited_agents', 'limited_experiments', 'zero_capital_growth'],
  },
  growth: {
    plan: 'growth', maxTenants: 3, maxUsers: 10, maxConnectors: 10, maxExperiments: 50,
    maxAgentRuns: 500, maxAiTokensPerMonth: 1_000_000,
    features: ['connectors', 'advanced_intelligence', 'additional_agents', 'email_delivery'],
  },
  pro: {
    plan: 'pro', maxTenants: 10, maxUsers: 50, maxConnectors: 25, maxExperiments: 500,
    maxAgentRuns: 5000, maxAiTokensPerMonth: 10_000_000,
    features: ['optimization', 'causal', 'advanced_execution', 'payment_verification', 'lakehouse'],
  },
  enterprise: {
    plan: 'enterprise', maxTenants: Infinity, maxUsers: Infinity, maxConnectors: Infinity,
    maxExperiments: Infinity, maxAgentRuns: Infinity, maxAiTokensPerMonth: Infinity,
    features: ['dedicated_tenancy', 'governance', 'sso', 'data_residency', 'private_models', 'enterprise_kms'],
  },
}

// In-memory usage store (production: Postgres table)
const usageStore: UsageEntry[] = []
const tenantPlans = new Map<string, Plan>()

export function createBillingService(): BillingService {
  return {
    async recordUsage(entry) {
      usageStore.push({ ...entry, recordedAt: new Date() })
    },

    async getUsageSummary(tenantId, period) {
      const entries = usageStore.filter((e) =>
        e.tenantId === tenantId &&
        e.recordedAt >= period.start &&
        e.recordedAt <= period.end
      )
      const byType: Record<string, { amount: number; cost: number }> = {}
      let totalCost = 0
      for (const e of entries) {
        if (!byType[e.type]) byType[e.type] = { amount: 0, cost: 0 }
        byType[e.type].amount += e.amount
        byType[e.type].cost += e.cost
        totalCost += e.cost
      }
      return { tenantId, period, totalCost, byType }
    },

    getPlan(tenantId) {
      return tenantPlans.get(tenantId) ?? 'free'
    },

    getEntitlements(tenantId) {
      const plan = this.getPlan(tenantId)
      return PLAN_ENTITLEMENTS[plan]
    },
  }
}

export function setTenantPlan(tenantId: string, plan: Plan): void {
  tenantPlans.set(tenantId, plan)
}

export { PLAN_ENTITLEMENTS }
