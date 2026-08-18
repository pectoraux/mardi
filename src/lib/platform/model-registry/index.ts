// =============================================================================
// Model Registry (Section 24)
// =============================================================================
// Every model records: provider, model, version, training data version,
// prompt version, tool schema version, deployment, evaluation results,
// cost, latency, status.
//
// Supports: active, candidate, deprecated, rolled back.

export interface ModelRecord {
  id: string
  name: string
  provider: string
  version: string
  type: 'predictive' | 'propensity' | 'uplift' | 'forecast' | 'causal' | 'llm' | 'embedding'
  status: 'active' | 'candidate' | 'deprecated' | 'rolled_back'
  costPerInvocation: number
  avgLatencyMs: number
  promptVersion?: string
  toolSchemaVersion?: string
  evaluationResults?: Record<string, number>
  deployedAt?: Date
  createdAt: Date
}

const registry = new Map<string, ModelRecord>()

export function registerModel(model: ModelRecord): void {
  registry.set(model.id, model)
}

export function getModel(id: string): ModelRecord | undefined {
  return registry.get(id)
}

export function listModels(filter?: { type?: string; status?: string }): ModelRecord[] {
  return Array.from(registry.values()).filter((m) => {
    if (filter?.type && m.type !== filter.type) return false
    if (filter?.status && m.status !== filter.status) return false
    return true
  })
}

export function getActiveModel(type: ModelRecord['type']): ModelRecord | undefined {
  return Array.from(registry.values()).find((m) => m.type === type && m.status === 'active')
}

export function promoteModel(id: string): void {
  const model = registry.get(id)
  if (!model) return
  // Deprecate other models of the same type
  for (const [mid, m] of registry) {
    if (m.type === model.type && m.status === 'active') {
      registry.set(mid, { ...m, status: 'deprecated' })
    }
  }
  registry.set(id, { ...model, status: 'active', deployedAt: new Date() })
}

export function rollbackModel(id: string): void {
  const model = registry.get(id)
  if (!model) return
  registry.set(id, { ...model, status: 'rolled_back' })
}

// Register default models
registerModel({
  id: 'llm-zai-glm46',
  name: 'glm-4.6',
  provider: 'zai',
  version: 'glm-4.6-v1',
  type: 'llm',
  status: 'active',
  costPerInvocation: 0.002,
  avgLatencyMs: 8000,
  promptVersion: 'v1',
  toolSchemaVersion: 'v1',
  createdAt: new Date(),
})

registerModel({
  id: 'embedding-hash-256',
  name: 'hash-256',
  provider: 'local',
  version: 'hash-v1',
  type: 'embedding',
  status: 'active',
  costPerInvocation: 0,
  avgLatencyMs: 1,
  createdAt: new Date(),
})

registerModel({
  id: 'causal-did-v1',
  name: 'difference-in-differences',
  provider: 'local',
  version: 'did-v1',
  type: 'causal',
  status: 'active',
  costPerInvocation: 0,
  avgLatencyMs: 50,
  createdAt: new Date(),
})
