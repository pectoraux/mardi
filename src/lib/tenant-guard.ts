// =============================================================================
// tenant-guard — the defense-in-depth repository layer (Sections 4, 5, 24)
// =============================================================================
// EVERY tenant-owned Prisma model access MUST go through this module. It
// re-asserts the active tenant_id from the TenantContext on every read &
// write, so that application code cannot accidentally issue unscoped
// cross-tenant queries. This is the SQLite-environment substitute for
// PostgreSQL Row Level Security.
//
// Invariants enforced:
//  * reads always filter `where: { tenantId }` (merged, never overridden)
//  * creates always inject `data: { tenantId }`
//  * updates/deletes always require `where: { id, tenantId }`
//  * a missing TenantContext throws (fail-closed)

import { db } from './db'
import { getTenantContext, requireTenantId } from './tenant-context'

// Prisma's WhereInput types are large; we use a minimal structural type to
// avoid coupling this guard to the generated client surface.
type AnyWhere = Record<string, unknown>
type AnyData = Record<string, unknown>
type AnyInclude = Record<string, unknown>

function mergeTenant<T extends AnyWhere>(where: T | undefined): T {
  const tid = requireTenantId()
  if (where && typeof where === 'object' && 'tenantId' in where) {
    // Caller already set tenantId — assert it matches the context.
    if (where.tenantId !== tid) {
      throw new TenantIsolationViolation(
        `tenant_guard: where.tenantId (${String(where.tenantId)}) != context.tenantId (${tid})`
      )
    }
    return where
  }
  return { ...(where ?? {}), tenantId: tid } as T
}

export class TenantIsolationViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantIsolationViolation'
  }
}

// ---------------------------------------------------------------------------
// Generic typed accessor — wraps a Prisma delegate with tenant enforcement.
// ---------------------------------------------------------------------------
export function tenantModel<Delegate>(name: string): Delegate {
  // @ts-expect-error — dynamic delegate access on the prisma client
  const delegate: Delegate = db[name]
  if (!delegate) throw new Error(`tenantModel: unknown model "${name}"`)
  return new Proxy(delegate as object, {
    get(_target, prop: string) {
      const ctx = peekSafe()
      if (!ctx) {
        throw new TenantIsolationViolation(
          `tenantModel(${name}).${prop}: no active TenantContext`
        )
      }
      // @ts-expect-error dynamic
      const orig = delegate[prop]
      if (typeof orig !== 'function') return orig

      // Methods that take a single args object with `where` / `data`.
      if (
        prop === 'findUnique' ||
        prop === 'findUniqueOrThrow'
      ) {
        return (args?: { where?: AnyWhere; include?: AnyInclude; select?: AnyInclude }) =>
          orig.call(delegate, { ...args, where: mergeTenant(args?.where) })
      }
      if (prop === 'findFirst' || prop === 'findFirstOrThrow') {
        return (args?: { where?: AnyWhere; include?: AnyInclude; select?: AnyInclude; orderBy?: unknown; take?: number; skip?: number }) =>
          orig.call(delegate, { ...args, where: mergeTenant(args?.where) })
      }
      if (prop === 'findMany') {
        return (args?: { where?: AnyWhere; include?: AnyInclude; select?: AnyInclude; orderBy?: unknown; take?: number; skip?: number; cursor?: AnyWhere }) =>
          orig.call(delegate, { ...args, where: mergeTenant(args?.where) })
      }
      if (prop === 'count') {
        return (args?: { where?: AnyWhere }) =>
          orig.call(delegate, { ...args, where: mergeTenant(args?.where) })
      }
      if (prop === 'aggregate') {
        return (args?: { where?: AnyWhere; _sum?: unknown; _avg?: unknown; _count?: unknown; _min?: unknown; _max?: unknown }) =>
          orig.call(delegate, { ...args, where: mergeTenant(args?.where) })
      }
      if (prop === 'groupBy') {
        return (args?: { where?: AnyWhere; by?: unknown; _sum?: unknown; _avg?: unknown; _count?: unknown }) =>
          orig.call(delegate, { ...args, where: mergeTenant(args?.where) })
      }
      if (prop === 'create') {
        return (args: { data: AnyData; include?: AnyInclude; select?: AnyInclude }) => {
          const tid = requireTenantId()
          const data = { ...args.data, tenantId: tid }
          if (args.data && 'tenantId' in args.data && args.data.tenantId !== tid) {
            throw new TenantIsolationViolation(
              `create(${name}).tenantId mismatch`
            )
          }
          return orig.call(delegate, { ...args, data })
        }
      }
      if (prop === 'createMany') {
        return (args: { data: AnyData | AnyData[]; skipDuplicates?: boolean }) => {
          const tid = requireTenantId()
          const arr = Array.isArray(args.data) ? args.data : [args.data]
          for (const d of arr) {
            if ('tenantId' in d && d.tenantId !== tid) {
              throw new TenantIsolationViolation(`createMany(${name}).tenantId mismatch`)
            }
          }
          const data = arr.map((d) => ({ tenantId: tid, ...d }))
          return orig.call(delegate, { ...args, data })
        }
      }
      if (prop === 'update') {
        return (args: { where: AnyWhere; data: AnyData; include?: AnyInclude; select?: AnyInclude }) => {
          if ('tenantId' in args.data) {
            const tid = requireTenantId()
            if (args.data.tenantId !== tid) {
              throw new TenantIsolationViolation(`update(${name}).tenantId reassignment forbidden`)
            }
          }
          return orig.call(delegate, { ...args, where: mergeTenant(args.where) })
        }
      }
      if (prop === 'updateMany') {
        return (args: { where: AnyWhere; data: AnyData }) => {
          if ('tenantId' in args.data) {
            const tid = requireTenantId()
            if (args.data.tenantId !== tid) {
              throw new TenantIsolationViolation(`updateMany(${name}).tenantId reassignment forbidden`)
            }
          }
          return orig.call(delegate, { ...args, where: mergeTenant(args.where) })
        }
      }
      if (prop === 'upsert') {
        return (args: { where: AnyWhere; create: AnyData; update: AnyData; include?: AnyInclude; select?: AnyInclude }) => {
          const tid = requireTenantId()
          const create = { ...args.create, tenantId: tid }
          const where = mergeTenant(args.where)
          if ('tenantId' in args.update && args.update.tenantId !== tid) {
            throw new TenantIsolationViolation(`upsert(${name}).tenantId reassignment forbidden`)
          }
          return orig.call(delegate, { ...args, where, create })
        }
      }
      if (prop === 'delete') {
        return (args: { where: AnyWhere; include?: AnyInclude; select?: AnyInclude }) =>
          orig.call(delegate, { ...args, where: mergeTenant(args.where) })
      }
      if (prop === 'deleteMany') {
        return (args?: { where?: AnyWhere }) =>
          orig.call(delegate, { ...args, where: mergeTenant(args?.where) })
      }
      // Pass-through for anything else (e.g. $queryRaw is not exposed here by design).
      return orig.bind(delegate)
    },
  }) as Delegate
}

function peekSafe() {
  try {
    return getTenantContext()
  } catch {
    return undefined
  }
}

// ---------------------------------------------------------------------------
// Pre-bound tenant-scoped models (typed loosely — callers know the shape).
// ---------------------------------------------------------------------------
import type {
  PrismaClient,
  Tenant,
  Organization,
  Brand,
  Product,
  Customer,
  Audience,
  Creative,
  Campaign,
  AdSet,
  Ad,
  Interaction,
  Connector,
  RawRecord,
  Event,
  Edge,
  Experiment,
  CausalEstimate,
  Recommendation,
  Decision,
  Approval,
  Workflow,
  WorkflowStep,
  AgentRun,
  AgentToolCall,
  AuditLog,
  Policy,
  User,
  SecretRef,
  CapitalLedgerEntry,
} from '@prisma/client'

type DelegateOf<M> = PrismaClient[Extract<keyof PrismaClient, string> & string] extends never ? never : {
  findUnique: (args?: any) => Promise<M | null>
  findFirst: (args?: any) => Promise<M | null>
  findMany: (args?: any) => Promise<M[]>
  count: (args?: any) => Promise<number>
  create: (args: any) => Promise<M>
  createMany: (args: any) => Promise<{ count: number }>
  update: (args: any) => Promise<M>
  updateMany: (args: any) => Promise<{ count: number }>
  upsert: (args: any) => Promise<M>
  delete: (args: any) => Promise<M>
  deleteMany: (args?: any) => Promise<{ count: number }>
  aggregate: (args?: any) => Promise<any>
  groupBy: (args?: any) => Promise<any[]>
}

export const t = {
  tenant: tenantModel<DelegateOf<Tenant>>('tenant'),
  organization: tenantModel<DelegateOf<Organization>>('organization'),
  brand: tenantModel<DelegateOf<Brand>>('brand'),
  product: tenantModel<DelegateOf<Product>>('product'),
  customer: tenantModel<DelegateOf<Customer>>('customer'),
  audience: tenantModel<DelegateOf<Audience>>('audience'),
  creative: tenantModel<DelegateOf<Creative>>('creative'),
  campaign: tenantModel<DelegateOf<Campaign>>('campaign'),
  adset: tenantModel<DelegateOf<AdSet>>('adSet'),
  ad: tenantModel<DelegateOf<Ad>>('ad'),
  interaction: tenantModel<DelegateOf<Interaction>>('interaction'),
  connector: tenantModel<DelegateOf<Connector>>('connector'),
  rawRecord: tenantModel<DelegateOf<RawRecord>>('rawRecord'),
  event: tenantModel<DelegateOf<Event>>('event'),
  edge: tenantModel<DelegateOf<Edge>>('edge'),
  experiment: tenantModel<DelegateOf<Experiment>>('experiment'),
  causalEstimate: tenantModel<DelegateOf<CausalEstimate>>('causalEstimate'),
  recommendation: tenantModel<DelegateOf<Recommendation>>('recommendation'),
  decision: tenantModel<DelegateOf<Decision>>('decision'),
  approval: tenantModel<DelegateOf<Approval>>('approval'),
  workflow: tenantModel<DelegateOf<Workflow>>('workflow'),
  workflowStep: tenantModel<DelegateOf<WorkflowStep>>('workflowStep'),
  agentRun: tenantModel<DelegateOf<AgentRun>>('agentRun'),
  agentToolCall: tenantModel<DelegateOf<AgentToolCall>>('agentToolCall'),
  auditLog: tenantModel<DelegateOf<AuditLog>>('auditLog'),
  policy: tenantModel<DelegateOf<Policy>>('policy'),
  user: tenantModel<DelegateOf<User>>('user'),
  capitalLedgerEntry: tenantModel<DelegateOf<CapitalLedgerEntry>>('capitalLedgerEntry'),
}

// The `tenant` model itself is special: it must be readable WITHOUT a
// TenantContext (to resolve slug -> id during auth). We expose the raw
// prisma client for that one operation only.
export { db as rawDb }
