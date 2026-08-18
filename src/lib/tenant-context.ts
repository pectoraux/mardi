// =============================================================================
// TenantContext — the immutable per-request identity (Section 4)
// =============================================================================
// Propagates through HTTP -> service -> repository -> storage via
// Node's AsyncLocalStorage. This is the SQLite-environment equivalent of
// PostgreSQL Row Level Security: application code MUST go through the
// repository layer (`src/lib/tenant-guard.ts`) which re-asserts tenant_id
// on every query. Defense in depth:
//   1. middleware reads x-tenant-id header / cookie and runs context
//   2. repository layer NEVER accepts a tenant_id from the caller — it
//      always reads it from the active TenantContext
//   3. cross-tenant attack tests assert that one tenant cannot see another

import { AsyncLocalStorage } from 'node:async_hooks'
import { db } from './db'

export interface TenantContext {
  tenantId: string
  tenantSlug: string
  organizationId?: string
  userId?: string
  roles: string[]
  dataScopes: string[]
  region: string
  environment: string
  autonomyLevel: number
}

const storage = new AsyncLocalStorage<TenantContext>()

/** Run a callback within a TenantContext. */
export function withTenantContext<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn)
}

/** Get the active TenantContext, throws if none (fail-closed). */
export function getTenantContext(): TenantContext {
  const ctx = storage.getStore()
  if (!ctx) {
    throw new TenantContextError(
      'No active TenantContext. Every tenant-scoped call must run inside withTenantContext().'
    )
  }
  return ctx
}

/** Get the active tenant_id, throws if none. */
export function requireTenantId(): string {
  return getTenantContext().tenantId
}

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantContextError'
  }
}

/** Optional context (returns undefined if none) — used by background workers. */
export function peekTenantContext(): TenantContext | undefined {
  return storage.getStore()
}

// ---------------------------------------------------------------------------
// Tenant registry cache (in-memory, Section 4: tenant-scoped caches)
// ---------------------------------------------------------------------------

interface TenantRecord {
  id: string
  slug: string
  name: string
  autonomyLevel: number
  plan: string
  region: string
  learningOptIn: boolean
}

const tenantCache = new Map<string, TenantRecord>()
let cacheLoadedAt = 0
const CACHE_TTL_MS = 60_000

async function loadTenants(): Promise<void> {
  if (Date.now() - cacheLoadedAt < CACHE_TTL_MS && tenantCache.size > 0) return
  const rows = await db.tenant.findMany()
  tenantCache.clear()
  for (const r of rows) {
    tenantCache.set(r.slug, {
      id: r.id,
      slug: r.slug,
      name: r.name,
      autonomyLevel: r.autonomyLevel,
      plan: r.plan,
      region: r.region,
      learningOptIn: r.learningOptIn,
    })
  }
  cacheLoadedAt = Date.now()
}

export async function getTenantBySlug(slug: string): Promise<TenantRecord | undefined> {
  await loadTenants()
  return tenantCache.get(slug)
}

export async function listTenants(): Promise<TenantRecord[]> {
  await loadTenants()
  return Array.from(tenantCache.values())
}

export function invalidateTenantCache(): void {
  cacheLoadedAt = 0
  tenantCache.clear()
}

export function buildContext(t: TenantRecord, opts?: Partial<TenantContext>): TenantContext {
  return {
    tenantId: t.id,
    tenantSlug: t.slug,
    roles: ['marketer'],
    dataScopes: ['*'],
    region: t.region,
    environment: process.env.NODE_ENV ?? 'development',
    autonomyLevel: t.autonomyLevel,
    ...opts,
  }
}
