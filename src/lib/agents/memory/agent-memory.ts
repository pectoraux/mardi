// =============================================================================
// Agent Memory — 5 distinct memory types, all tenant-scoped (Section 22)
// =============================================================================
// Working Memory   — current task state
// Episodic Memory  — prior interactions and actions
// Semantic Memory  — tenant knowledge
// Procedural Memory — how the organization performs work
// Evidence Memory  — what has actually been demonstrated
//
// INVARIANT: all memory is tenant-scoped. Cross-tenant retrieval is impossible.

import type { TenantContext } from '../../tenant-context'

export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural' | 'evidence'

export interface MemoryEntry {
  id: string
  tenantId: string
  type: MemoryType
  agentName: string
  key: string
  value: unknown
  provenance?: string
  confidence?: number
  createdAt: Date
  expiresAt?: Date
}

export interface AgentMemoryPort {
  // Working memory (volatile, per-task)
  setWorking(ctx: TenantContext, agentName: string, key: string, value: unknown, ttlSeconds?: number): Promise<void>
  getWorking(ctx: TenantContext, agentName: string, key: string): Promise<unknown | null>
  clearWorking(ctx: TenantContext, agentName: string): Promise<void>

  // Episodic memory (interaction history)
  recordEpisode(ctx: TenantContext, agentName: string, episode: { prompt: string; response: string; toolsUsed: string[] }): Promise<void>
  getEpisodes(ctx: TenantContext, agentName: string, opts?: { limit?: number }): Promise<MemoryEntry[]>

  // Semantic memory (tenant knowledge)
  setSemantic(ctx: TenantContext, key: string, value: unknown, provenance?: string): Promise<void>
  getSemantic(ctx: TenantContext, key: string): Promise<unknown | null>
  searchSemantic(ctx: TenantContext, query: string): Promise<MemoryEntry[]>

  // Procedural memory (how-to)
  setProcedural(ctx: TenantContext, key: string, value: unknown): Promise<void>
  getProcedural(ctx: TenantContext, key: string): Promise<unknown | null>

  // Evidence memory (what has been demonstrated)
  recordEvidence(ctx: TenantContext, key: string, value: unknown, confidence: number, provenance: string): Promise<void>
  getEvidence(ctx: TenantContext, key: string): Promise<MemoryEntry | null>

  // Export / delete (privacy compliance)
  exportAll(ctx: TenantContext): Promise<MemoryEntry[]>
  deleteAll(ctx: TenantContext): Promise<void>
}

// In-memory bootstrap implementation (production: Postgres table)
const memoryStore = new Map<string, MemoryEntry[]>()

function tenantKey(ctx: TenantContext): string {
  return ctx.tenantId
}

export const InMemoryAgentMemory: AgentMemoryPort = {
  async setWorking(ctx, agentName, key, value, ttlSeconds) {
    const tk = tenantKey(ctx)
    if (!memoryStore.has(tk)) memoryStore.set(tk, [])
    const entry: MemoryEntry = {
      id: `${agentName}:${key}:${Date.now()}`,
      tenantId: ctx.tenantId,
      type: 'working',
      agentName,
      key,
      value,
      createdAt: new Date(),
      expiresAt: ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : undefined,
    }
    memoryStore.get(tk)!.push(entry)
  },

  async getWorking(ctx, agentName, key) {
    const entries = memoryStore.get(tenantKey(ctx)) ?? []
    const found = entries.filter((e) => e.type === 'working' && e.agentName === agentName && e.key === key)
    const latest = found[found.length - 1]
    if (!latest) return null
    if (latest.expiresAt && Date.now() > latest.expiresAt.getTime()) return null
    return latest.value
  },

  async clearWorking(ctx, agentName) {
    const tk = tenantKey(ctx)
    const entries = memoryStore.get(tk) ?? []
    memoryStore.set(tk, entries.filter((e) => !(e.type === 'working' && e.agentName === agentName)))
  },

  async recordEpisode(ctx, agentName, episode) {
    const tk = tenantKey(ctx)
    if (!memoryStore.has(tk)) memoryStore.set(tk, [])
    memoryStore.get(tk)!.push({
      id: `${agentName}:episode:${Date.now()}`,
      tenantId: ctx.tenantId,
      type: 'episodic',
      agentName,
      key: 'episode',
      value: episode,
      createdAt: new Date(),
    })
  },

  async getEpisodes(ctx, agentName, opts) {
    const entries = memoryStore.get(tenantKey(ctx)) ?? []
    return entries
      .filter((e) => e.type === 'episodic' && e.agentName === agentName)
      .slice(-(opts?.limit ?? 10))
      .reverse()
  },

  async setSemantic(ctx, key, value, provenance) {
    const tk = tenantKey(ctx)
    if (!memoryStore.has(tk)) memoryStore.set(tk, [])
    memoryStore.get(tk)!.push({
      id: `semantic:${key}:${Date.now()}`,
      tenantId: ctx.tenantId,
      type: 'semantic',
      agentName: '*',
      key,
      value,
      provenance,
      createdAt: new Date(),
    })
  },

  async getSemantic(ctx, key) {
    const entries = memoryStore.get(tenantKey(ctx)) ?? []
    const found = entries.filter((e) => e.type === 'semantic' && e.key === key)
    return found[found.length - 1]?.value ?? null
  },

  async searchSemantic(ctx, query) {
    const entries = memoryStore.get(tenantKey(ctx)) ?? []
    return entries.filter((e) =>
      e.type === 'semantic' &&
      (e.key.toLowerCase().includes(query.toLowerCase()) ||
       JSON.stringify(e.value).toLowerCase().includes(query.toLowerCase()))
    )
  },

  async setProcedural(ctx, key, value) {
    const tk = tenantKey(ctx)
    if (!memoryStore.has(tk)) memoryStore.set(tk, [])
    memoryStore.get(tk)!.push({
      id: `procedural:${key}:${Date.now()}`,
      tenantId: ctx.tenantId,
      type: 'procedural',
      agentName: '*',
      key,
      value,
      createdAt: new Date(),
    })
  },

  async getProcedural(ctx, key) {
    const entries = memoryStore.get(tenantKey(ctx)) ?? []
    const found = entries.filter((e) => e.type === 'procedural' && e.key === key)
    return found[found.length - 1]?.value ?? null
  },

  async recordEvidence(ctx, key, value, confidence, provenance) {
    const tk = tenantKey(ctx)
    if (!memoryStore.has(tk)) memoryStore.set(tk, [])
    memoryStore.get(tk)!.push({
      id: `evidence:${key}:${Date.now()}`,
      tenantId: ctx.tenantId,
      type: 'evidence',
      agentName: '*',
      key,
      value,
      confidence,
      provenance,
      createdAt: new Date(),
    })
  },

  async getEvidence(ctx, key) {
    const entries = memoryStore.get(tenantKey(ctx)) ?? []
    const found = entries.filter((e) => e.type === 'evidence' && e.key === key)
    return found[found.length - 1] ?? null
  },

  async exportAll(ctx) {
    return memoryStore.get(tenantKey(ctx)) ?? []
  },

  async deleteAll(ctx) {
    memoryStore.delete(tenantKey(ctx))
  },
}
