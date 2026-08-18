// Bootstrap Cache adapter — in-memory, tenant-scoped.
// Production: Redis adapter behind the same interface.

import type { CachePort } from '../../application/ports'
import type { TenantContext } from '../../tenant-context'

const store = new Map<string, { value: unknown; expiresAt: number | null }>()

function key(ctx: TenantContext, k: string): string {
  return `${ctx.tenantId}:${k}`
}

export const InMemoryCache: CachePort = {
  async get(ctx, k) {
    const entry = store.get(key(ctx, k))
    if (!entry) return null
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      store.delete(key(ctx, k))
      return null
    }
    return entry.value as never
  },

  async set(ctx, k, value, opts) {
    store.set(key(ctx, k), {
      value,
      expiresAt: opts?.ttlSeconds ? Date.now() + opts.ttlSeconds * 1000 : null,
    })
  },

  async delete(ctx, k) {
    store.delete(key(ctx, k))
  },

  async invalidatePattern(ctx, pattern) {
    const prefix = `${ctx.tenantId}:`
    const regex = new RegExp(pattern.replace(/\*/g, '.*'))
    for (const k of store.keys()) {
      if (k.startsWith(prefix)) {
        const suffix = k.slice(prefix.length)
        if (regex.test(suffix)) store.delete(k)
      }
    }
  },
}
