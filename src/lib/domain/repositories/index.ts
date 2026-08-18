// =============================================================================
// Repository PORT interfaces — the domain persistence contract.
// =============================================================================
// SECTION 5 HARDENING: "Every repository method receives a TenantContext;
// repositories reject calls without a valid context." These interfaces
// enforce that at the type level — there is NO method signature that
// accepts data without a TenantContext.
//
// The domain layer, application services, and agents depend ONLY on these
// interfaces. They NEVER import Prisma or know which database is backing
// the system. A Prisma adapter (SQLite or Postgres) implements these.
//
// This is the seam that lets the system move from SQLite bootstrap to
// Postgres production to pooled multi-tenant to dedicated enterprise
// tenant WITHOUT changing business logic (ADR-0003).

import type { TenantContext } from '../../tenant-context'
import type {
  Campaign, Customer, Experiment, CausalEstimate, Recommendation,
  Decision, Edge, CanonicalEvent, Connector, RawRecord, Interaction,
  Creative, Brand, Product, Audience, AgentRun, CapitalLedgerEntry,
  CapitalSummary, User, WaitlistEntry, Tenant,
} from '../entities'

// Generic query options — portable across SQLite/Postgres (no Prisma types).
export interface QueryOptions {
  where?: Record<string, unknown>
  orderBy?: Record<string, 'asc' | 'desc'>
  take?: number
  skip?: number
}

export interface CreateOptions {
  data: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Campaign repository
// ---------------------------------------------------------------------------
export interface CampaignRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Campaign[]>
  findUnique(ctx: TenantContext, id: string): Promise<Campaign | null>
  findFirst(ctx: TenantContext, where: Record<string, unknown>): Promise<Campaign | null>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Campaign>
  update(ctx: TenantContext, id: string, data: Record<string, unknown>): Promise<Campaign>
  updateMany(ctx: TenantContext, where: Record<string, unknown>, data: Record<string, unknown>): Promise<{ count: number }>
  delete(ctx: TenantContext, id: string): Promise<void>
  count(ctx: TenantContext, where?: Record<string, unknown>): Promise<number>
}

// ---------------------------------------------------------------------------
// Customer repository
// ---------------------------------------------------------------------------
export interface CustomerRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Customer[]>
  findUnique(ctx: TenantContext, id: string): Promise<Customer | null>
  findFirst(ctx: TenantContext, where: Record<string, unknown>): Promise<Customer | null>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Customer>
  createMany(ctx: TenantContext, data: Record<string, unknown>[]): Promise<{ count: number }>
  update(ctx: TenantContext, id: string, data: Record<string, unknown>): Promise<Customer>
  count(ctx: TenantContext, where?: Record<string, unknown>): Promise<number>
}

// ---------------------------------------------------------------------------
// Interaction repository
// ---------------------------------------------------------------------------
export interface InteractionRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Interaction[]>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Interaction>
  createMany(ctx: TenantContext, data: Record<string, unknown>[]): Promise<{ count: number }>
  count(ctx: TenantContext, where?: Record<string, unknown>): Promise<number>
}

// ---------------------------------------------------------------------------
// Experiment repository
// ---------------------------------------------------------------------------
export interface ExperimentRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Experiment[]>
  findUnique(ctx: TenantContext, id: string): Promise<Experiment | null>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Experiment>
  update(ctx: TenantContext, id: string, data: Record<string, unknown>): Promise<Experiment>
}

// ---------------------------------------------------------------------------
// Causal estimate repository
// ---------------------------------------------------------------------------
export interface CausalEstimateRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<CausalEstimate[]>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<CausalEstimate>
}

// ---------------------------------------------------------------------------
// Recommendation repository (with AI versioning)
// ---------------------------------------------------------------------------
export interface RecommendationRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Recommendation[]>
  findUnique(ctx: TenantContext, id: string): Promise<Recommendation | null>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Recommendation>
  update(ctx: TenantContext, id: string, data: Record<string, unknown>): Promise<Recommendation>
}

// ---------------------------------------------------------------------------
// Decision repository (immutable ledger)
// ---------------------------------------------------------------------------
export interface DecisionRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Decision[]>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Decision>
  update(ctx: TenantContext, id: string, data: Record<string, unknown>): Promise<Decision>
}

// ---------------------------------------------------------------------------
// Evidence graph repository
// ---------------------------------------------------------------------------
export interface EvidenceGraphRepository {
  findEdges(ctx: TenantContext, opts?: QueryOptions): Promise<Edge[]>
  findEdgesFrom(ctx: TenantContext, sourceType: string, sourceId: string): Promise<Edge[]>
  findEdgesTo(ctx: TenantContext, targetType: string, targetId: string): Promise<Edge[]>
  linkEvidence(
    ctx: TenantContext,
    source: { type: string; id: string },
    relation: string,
    target: { type: string; id: string },
    opts?: { weight?: number; metadata?: Record<string, unknown> }
  ): Promise<void>
}

// ---------------------------------------------------------------------------
// Event repository
// ---------------------------------------------------------------------------
export interface EventRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<CanonicalEvent[]>
  emit(ctx: TenantContext, event: {
    eventType: string
    source: string
    entityType?: string
    entityId?: string
    occurredAt?: Date
    properties: Record<string, unknown>
    lineageId?: string
  }): Promise<CanonicalEvent>
}

// ---------------------------------------------------------------------------
// Connector & raw record repository
// ---------------------------------------------------------------------------
export interface ConnectorRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Connector[]>
  findUnique(ctx: TenantContext, id: string): Promise<Connector | null>
  update(ctx: TenantContext, id: string, data: Record<string, unknown>): Promise<Connector>
}

export interface RawRecordRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<RawRecord[]>
  findUniqueBySource(ctx: TenantContext, connectorId: string, sourceRecordId: string): Promise<RawRecord | null>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<RawRecord>
}

// ---------------------------------------------------------------------------
// Creative, brand, product, audience repositories
// ---------------------------------------------------------------------------
export interface CreativeRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Creative[]>
  findFirst(ctx: TenantContext, where: Record<string, unknown>): Promise<Creative | null>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Creative>
  update(ctx: TenantContext, id: string, data: Record<string, unknown>): Promise<Creative>
}

export interface BrandRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Brand[]>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Brand>
}

export interface ProductRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Product[]>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Product>
}

export interface AudienceRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<Audience[]>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<Audience>
}

// ---------------------------------------------------------------------------
// Agent run repository (for observability + cost attribution, Section 25/26)
// ---------------------------------------------------------------------------
export interface AgentRunRepository {
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<AgentRun>
  update(ctx: TenantContext, id: string, data: Record<string, unknown>): Promise<AgentRun>
}

// ---------------------------------------------------------------------------
// Capital ledger repository (Zero-Capital Growth Engine)
// ---------------------------------------------------------------------------
export interface CapitalLedgerRepository {
  findMany(ctx: TenantContext, opts?: QueryOptions): Promise<CapitalLedgerEntry[]>
  create(ctx: TenantContext, data: Record<string, unknown>): Promise<CapitalLedgerEntry>
  getSummary(ctx: TenantContext): Promise<CapitalSummary>
}

// ---------------------------------------------------------------------------
// Aggregate repository interface — the full persistence port.
// Application code receives this aggregate and never knows which adapter
// backs it.
// ---------------------------------------------------------------------------
export interface Repository {
  campaign: CampaignRepository
  customer: CustomerRepository
  interaction: InteractionRepository
  experiment: ExperimentRepository
  causalEstimate: CausalEstimateRepository
  recommendation: RecommendationRepository
  decision: DecisionRepository
  evidenceGraph: EvidenceGraphRepository
  event: EventRepository
  connector: ConnectorRepository
  rawRecord: RawRecordRepository
  creative: CreativeRepository
  brand: BrandRepository
  product: ProductRepository
  audience: AudienceRepository
  agentRun: AgentRunRepository
  capitalLedger: CapitalLedgerRepository
}

// ---------------------------------------------------------------------------
// Identity repositories — these span tenants (admin users, waitlist) so they
// do NOT take a TenantContext. They are used only by the auth/admin layer.
// ---------------------------------------------------------------------------
export interface IdentityRepository {
  findUserByEmail(email: string): Promise<User | null>
  findUserById(id: string): Promise<User | null>
  createUser(data: Record<string, unknown>): Promise<User>
  findTenantBySlug(slug: string): Promise<Tenant | null>
  findTenantById(id: string): Promise<Tenant | null>
  listTenants(): Promise<Tenant[]>
  updateTenant(id: string, data: Record<string, unknown>): Promise<Tenant>
  // Waitlist
  createWaitlistEntry(data: Record<string, unknown>): Promise<WaitlistEntry>
  findWaitlistEntryByEmail(email: string): Promise<WaitlistEntry | null>
  findWaitlistEntries(status?: string): Promise<WaitlistEntry[]>
  updateWaitlistEntry(id: string, data: Record<string, unknown>): Promise<WaitlistEntry>
}
