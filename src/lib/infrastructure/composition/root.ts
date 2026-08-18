// =============================================================================
// Composition root — the single place where infrastructure adapters are
// wired into the application ports (hexagonal architecture).
// =============================================================================
// Application code calls getRepository(), getLLMProvider(), getExecutor()
// and receives the port interface. It NEVER knows which adapter backs it.
//
// Adapter selection is config-driven:
//   DATABASE_PROVIDER = prisma_sqlite | prisma_postgres  (both use Prisma)
//   LLM_PROVIDER      = zai | openai | anthropic | gemini | local
//   EXECUTION_MODE    = SIMULATION | SANDBOX | LIVE  (default SIMULATION)
//
// This is the seam that lets the system move from SQLite bootstrap to
// Postgres production to a different LLM provider WITHOUT changing any
// business logic (ADR-0003, ADR-0004, ADR-0005).

import type { Repository, IdentityRepository } from '../../domain/repositories'
import type { LLMProvider, ModeAwareExecutor, ExecutionMode } from '../../application/ports'
import { prismaRepository, prismaIdentityRepository, db as rawDb } from '../persistence/prisma/PrismaRepository'
import { getLLMProvider } from '../llm/LLMProviderRegistry'
import type { TenantContext } from '../../tenant-context'

// ---------------------------------------------------------------------------
// Repository — Prisma adapter (works for both SQLite and Postgres)
// ---------------------------------------------------------------------------
let _repo: Repository | null = null
export function getRepository(): Repository {
  if (_repo) return _repo
  // Both prisma_sqlite and prisma_postgres use the same Prisma adapter —
  // Prisma handles dialect differences. The provider is recorded for
  // observability but doesn't change the adapter.
  _repo = prismaRepository
  return _repo
}

let _identity: IdentityRepository | null = null
export function getIdentityRepository(): IdentityRepository {
  if (_identity) return _identity
  _identity = prismaIdentityRepository
  return _identity
}

// ---------------------------------------------------------------------------
// LLM provider
// ---------------------------------------------------------------------------
export function getAIProvider(): LLMProvider {
  return getLLMProvider()
}

// ---------------------------------------------------------------------------
// Mode-aware executor (ADR-0005)
// ---------------------------------------------------------------------------
const DEFAULT_MODE: ExecutionMode = 'SIMULATION'

const modeAwareExecutor: ModeAwareExecutor = {
  async getMode(tenantId: string): Promise<ExecutionMode> {
    try {
      const tenant = await rawDb.tenant.findUnique({ where: { id: tenantId }, select: { executionMode: true } })
      // @ts-expect-error executionMode column added in schema
      return (tenant?.executionMode as ExecutionMode) ?? DEFAULT_MODE
    } catch {
      return DEFAULT_MODE
    }
  },

  async execute(ctx, action) {
    const mode = await this.getMode(ctx.tenantId)
    if (mode === 'SIMULATION') {
      // Record the action but do not perform it
      console.log(`[executor] SIMULATION: skipping action "${action.type}" — ${action.description}`)
      return { result: null, mode, simulated: true }
    }
    if (mode === 'SANDBOX' && action.performSandbox) {
      const result = await action.performSandbox()
      return { result, mode, simulated: false }
    }
    if (mode === 'LIVE') {
      // LIVE requires autonomy ≥ 4 + approval (enforced by caller)
      const result = await action.perform()
      return { result, mode, simulated: false }
    }
    // SANDBOX without a sandbox impl, or unknown mode — simulate
    console.log(`[executor] ${mode}: no sandbox impl for "${action.type}", simulating`)
    return { result: null, mode, simulated: true }
  },
}

export function getExecutor(): ModeAwareExecutor {
  return modeAwareExecutor
}

// ---------------------------------------------------------------------------
// Composition root export — application code imports from here.
// ---------------------------------------------------------------------------
export { prismaRepository, prismaIdentityRepository } from '../persistence/prisma/PrismaRepository'
export { getLLMProvider, listProviders } from '../llm/LLMProviderRegistry'
export type { Repository, IdentityRepository } from '../../domain/repositories'
export type { LLMProvider, ModeAwareExecutor, ExecutionMode } from '../../application/ports'
export type { TenantContext } from '../../tenant-context'
