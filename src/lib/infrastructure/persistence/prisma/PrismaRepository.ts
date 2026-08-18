// =============================================================================
// Prisma adapter — implements the Repository port via Prisma + tenant-guard.
// =============================================================================
// This adapter is DATABASE-AGNOSTIC: it uses only portable Prisma operations
// that work identically on SQLite and PostgreSQL. The same adapter backs
// both `DATABASE_PROVIDER=prisma_sqlite` and `prisma_postgres` — Prisma
// handles dialect differences. (ADR-0003)
//
// Every method enforces the tenant invariant: the TenantContext is the FIRST
// parameter and tenant_id is merged into every query by the tenant-guard.
// A call without a valid TenantContext throws (fail-closed).

import type {
  Repository, CampaignRepository, CustomerRepository, InteractionRepository,
  ExperimentRepository, CausalEstimateRepository, RecommendationRepository,
  DecisionRepository, EvidenceGraphRepository, EventRepository,
  ConnectorRepository, RawRecordRepository, CreativeRepository,
  BrandRepository, ProductRepository, AudienceRepository,
  AgentRunRepository, CapitalLedgerRepository,
  QueryOptions,
} from '../../../domain/repositories'
import type { TenantContext } from '../../../tenant-context'
import type { CanonicalEvent, CapitalSummary } from '../../../domain/entities'
import { t } from '../../../tenant-guard'
import { db as rawDb } from '../../../db'
import { requireTenantId } from '../../../tenant-context'
import { randomUUID } from 'node:crypto'

// Helper: convert QueryOptions to Prisma args (portable, no Prisma types leaked)
function toPrismaArgs(opts?: QueryOptions): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  if (opts?.where) args.where = opts.where
  if (opts?.orderBy) args.orderBy = opts.orderBy
  if (opts?.take !== undefined) args.take = opts.take
  if (opts?.skip !== undefined) args.skip = opts.skip
  return args
}

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------
const campaignRepo: CampaignRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.campaign.findMany(toPrismaArgs(opts) as never) as never
  },
  async findUnique(ctx, id) {
    void ctx
    return t.campaign.findUnique({ where: { id } }) as never
  },
  async findFirst(ctx, where) {
    void ctx
    return t.campaign.findFirst({ where }) as never
  },
  async create(ctx, data) {
    void ctx
    return t.campaign.create({ data: data as never }) as never
  },
  async update(ctx, id, data) {
    void ctx
    return t.campaign.update({ where: { id }, data: data as never }) as never
  },
  async updateMany(ctx, where, data) {
    void ctx
    return t.campaign.updateMany({ where, data: data as never }) as never
  },
  async delete(ctx, id) {
    void ctx
    await t.campaign.delete({ where: { id } })
  },
  async count(ctx, where) {
    void ctx
    return t.campaign.count(where ? { where } : {})
  },
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
const customerRepo: CustomerRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.customer.findMany(toPrismaArgs(opts) as never) as never
  },
  async findUnique(ctx, id) {
    void ctx
    return t.customer.findUnique({ where: { id } }) as never
  },
  async findFirst(ctx, where) {
    void ctx
    return t.customer.findFirst({ where }) as never
  },
  async create(ctx, data) {
    void ctx
    return t.customer.create({ data: data as never }) as never
  },
  async createMany(ctx, data) {
    void ctx
    return t.customer.createMany({ data: data as never, skipDuplicates: true })
  },
  async update(ctx, id, data) {
    void ctx
    return t.customer.update({ where: { id }, data: data as never }) as never
  },
  async count(ctx, where) {
    void ctx
    return t.customer.count(where ? { where } : {})
  },
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------
const interactionRepo: InteractionRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.interaction.findMany(toPrismaArgs(opts) as never) as never
  },
  async create(ctx, data) {
    void ctx
    return t.interaction.create({ data: data as never }) as never
  },
  async createMany(ctx, data) {
    void ctx
    return t.interaction.createMany({ data: data as never, skipDuplicates: true })
  },
  async count(ctx, where) {
    void ctx
    return t.interaction.count(where ? { where } : {})
  },
}

// ---------------------------------------------------------------------------
// Experiment
// ---------------------------------------------------------------------------
const experimentRepo: ExperimentRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.experiment.findMany(toPrismaArgs(opts) as never) as never
  },
  async findUnique(ctx, id) {
    void ctx
    return t.experiment.findUnique({ where: { id } }) as never
  },
  async create(ctx, data) {
    void ctx
    return t.experiment.create({ data: data as never }) as never
  },
  async update(ctx, id, data) {
    void ctx
    return t.experiment.update({ where: { id }, data: data as never }) as never
  },
}

// ---------------------------------------------------------------------------
// Causal estimate
// ---------------------------------------------------------------------------
const causalEstimateRepo: CausalEstimateRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.causalEstimate.findMany(toPrismaArgs(opts) as never) as never
  },
  async create(ctx, data) {
    void ctx
    return t.causalEstimate.create({ data: data as never }) as never
  },
}

// ---------------------------------------------------------------------------
// Recommendation (with AI versioning fields)
// ---------------------------------------------------------------------------
const recommendationRepo: RecommendationRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.recommendation.findMany(toPrismaArgs(opts) as never) as never
  },
  async findUnique(ctx, id) {
    void ctx
    return t.recommendation.findUnique({ where: { id } }) as never
  },
  async create(ctx, data) {
    void ctx
    return t.recommendation.create({ data: data as never }) as never
  },
  async update(ctx, id, data) {
    void ctx
    return t.recommendation.update({ where: { id }, data: data as never }) as never
  },
}

// ---------------------------------------------------------------------------
// Decision (immutable ledger)
// ---------------------------------------------------------------------------
const decisionRepo: DecisionRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.decision.findMany(toPrismaArgs(opts) as never) as never
  },
  async create(ctx, data) {
    void ctx
    return t.decision.create({ data: data as never }) as never
  },
  async update(ctx, id, data) {
    void ctx
    return t.decision.update({ where: { id }, data: data as never }) as never
  },
}

// ---------------------------------------------------------------------------
// Evidence graph
// ---------------------------------------------------------------------------
const evidenceGraphRepo: EvidenceGraphRepository = {
  async findEdges(ctx, opts) {
    void ctx
    return t.edge.findMany(toPrismaArgs(opts) as never) as never
  },
  async findEdgesFrom(ctx, sourceType, sourceId) {
    void ctx
    return t.edge.findMany({ where: { sourceType, sourceId } }) as never
  },
  async findEdgesTo(ctx, targetType, targetId) {
    void ctx
    return t.edge.findMany({ where: { targetType, targetId } }) as never
  },
  async linkEvidence(ctx, source, relation, target, opts) {
    void ctx
    const weight = opts?.weight ?? 1
    const metadata = opts?.metadata ? JSON.stringify(opts.metadata) : null
    await t.edge.upsert({
      where: {
        tenantId_sourceType_sourceId_relation_targetType_targetId: {
          tenantId: requireTenantId(),
          sourceType: source.type,
          sourceId: source.id,
          relation,
          targetType: target.type,
          targetId: target.id,
        },
      },
      create: {
        sourceType: source.type,
        sourceId: source.id,
        relation,
        targetType: target.type,
        targetId: target.id,
        weight,
        metadata,
      },
      update: { weight, metadata },
    } as never)
  },
}

// ---------------------------------------------------------------------------
// Event
// ---------------------------------------------------------------------------
const eventRepo: EventRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.event.findMany(toPrismaArgs(opts) as never) as never
  },
  async emit(ctx, event) {
    void ctx
    const tenantId = requireTenantId()
    const occurredAt = event.occurredAt ?? new Date()
    const eventId = `${tenantId}:${event.source}:${randomUUID()}`
    await t.event.create({
      data: {
        eventId,
        tenantId,
        eventType: event.eventType,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        source: event.source,
        occurredAt,
        schemaVersion: 1,
        payload: JSON.stringify(event.properties),
        lineageId: event.lineageId ?? null,
      } as never,
    })
    return {
      id: '',
      eventId,
      tenantId,
      eventType: event.eventType,
      entityType: event.entityType ?? null,
      entityId: event.entityId ?? null,
      source: event.source,
      occurredAt,
      ingestedAt: new Date(),
      schemaVersion: 1,
      payload: JSON.stringify(event.properties),
      lineageId: event.lineageId ?? null,
    } as CanonicalEvent
  },
}

// ---------------------------------------------------------------------------
// Connector & raw record
// ---------------------------------------------------------------------------
const connectorRepo: ConnectorRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.connector.findMany(toPrismaArgs(opts) as never) as never
  },
  async findUnique(ctx, id) {
    void ctx
    return t.connector.findUnique({ where: { id } }) as never
  },
  async update(ctx, id, data) {
    void ctx
    return t.connector.update({ where: { id }, data: data as never }) as never
  },
}

const rawRecordRepo: RawRecordRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.rawRecord.findMany(toPrismaArgs(opts) as never) as never
  },
  async findUniqueBySource(ctx, connectorId, sourceRecordId) {
    void ctx
    return t.rawRecord.findUnique({
      where: { connectorId_sourceRecordId: { connectorId, sourceRecordId } },
    }) as never
  },
  async create(ctx, data) {
    void ctx
    return t.rawRecord.create({ data: data as never }) as never
  },
}

// ---------------------------------------------------------------------------
// Creative, brand, product, audience
// ---------------------------------------------------------------------------
const creativeRepo: CreativeRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.creative.findMany(toPrismaArgs(opts) as never) as never
  },
  async findFirst(ctx, where) {
    void ctx
    return t.creative.findFirst({ where }) as never
  },
  async create(ctx, data) {
    void ctx
    return t.creative.create({ data: data as never }) as never
  },
  async update(ctx, id, data) {
    void ctx
    return t.creative.update({ where: { id }, data: data as never }) as never
  },
}

const brandRepo: BrandRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.brand.findMany(toPrismaArgs(opts) as never) as never
  },
  async create(ctx, data) {
    void ctx
    return t.brand.create({ data: data as never }) as never
  },
}

const productRepo: ProductRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.product.findMany(toPrismaArgs(opts) as never) as never
  },
  async create(ctx, data) {
    void ctx
    return t.product.create({ data: data as never }) as never
  },
}

const audienceRepo: AudienceRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.audience.findMany(toPrismaArgs(opts) as never) as never
  },
  async create(ctx, data) {
    void ctx
    return t.audience.create({ data: data as never }) as never
  },
}

// ---------------------------------------------------------------------------
// Agent run
// ---------------------------------------------------------------------------
const agentRunRepo: AgentRunRepository = {
  async create(ctx, data) {
    void ctx
    return t.agentRun.create({ data: data as never }) as never
  },
  async update(ctx, id, data) {
    void ctx
    return t.agentRun.update({ where: { id }, data: data as never }) as never
  },
}

// ---------------------------------------------------------------------------
// Capital ledger (Zero-Capital Growth Engine)
// ---------------------------------------------------------------------------
const capitalLedgerRepo: CapitalLedgerRepository = {
  async findMany(ctx, opts) {
    void ctx
    return t.capitalLedgerEntry.findMany(toPrismaArgs(opts) as never) as never
  },
  async create(ctx, data) {
    void ctx
    return t.capitalLedgerEntry.create({ data: data as never }) as never
  },
  async getSummary(ctx) {
    void ctx
    const entries = await t.capitalLedgerEntry.findMany({} as never) as unknown as Array<{ type: string; amount: number; currency: string }>
    const summary: CapitalSummary = {
      available: 0, committed: 0, spent: 0,
      expectedReturn: 0, realizedReturn: 0, reinvestmentPool: 0,
      currency: 'USD',
    }
    for (const e of entries) {
      switch (e.type) {
        case 'AVAILABLE': summary.available += e.amount; break
        case 'COMMITTED': summary.committed += e.amount; break
        case 'SPENT': summary.spent += e.amount; break
        case 'EXPECTED_RETURN': summary.expectedReturn += e.amount; break
        case 'REALIZED_RETURN': summary.realizedReturn += e.amount; break
        case 'REINVESTMENT': summary.reinvestmentPool += e.amount; break
      }
      summary.currency = e.currency || 'USD'
    }
    // Available = initial available - committed - spent + realized returns + reinvestment
    summary.available = summary.available - summary.committed - summary.spent + summary.realizedReturn + summary.reinvestmentPool
    return summary
  },
}

// ---------------------------------------------------------------------------
// Aggregate export
// ---------------------------------------------------------------------------
export const prismaRepository: Repository = {
  campaign: campaignRepo,
  customer: customerRepo,
  interaction: interactionRepo,
  experiment: experimentRepo,
  causalEstimate: causalEstimateRepo,
  recommendation: recommendationRepo,
  decision: decisionRepo,
  evidenceGraph: evidenceGraphRepo,
  event: eventRepo,
  connector: connectorRepo,
  rawRecord: rawRecordRepo,
  creative: creativeRepo,
  brand: brandRepo,
  product: productRepo,
  audience: audienceRepo,
  agentRun: agentRunRepo,
  capitalLedger: capitalLedgerRepo,
}

// ---------------------------------------------------------------------------
// Identity repository (spans tenants — no TenantContext)
// ---------------------------------------------------------------------------
import type { IdentityRepository } from '../../../domain/repositories'

export const prismaIdentityRepository: IdentityRepository = {
  async findUserByEmail(email) {
    return rawDb.user.findUnique({ where: { email } }) as never
  },
  async findUserById(id) {
    return rawDb.user.findUnique({ where: { id } }) as never
  },
  async createUser(data) {
    return rawDb.user.create({ data: data as never }) as never
  },
  async findTenantBySlug(slug) {
    return rawDb.tenant.findUnique({ where: { slug } }) as never
  },
  async findTenantById(id) {
    return rawDb.tenant.findUnique({ where: { id } }) as never
  },
  async listTenants() {
    return rawDb.tenant.findMany() as never
  },
  async updateTenant(id, data) {
    return rawDb.tenant.update({ where: { id }, data: data as never }) as never
  },
  async createWaitlistEntry(data) {
    return rawDb.waitlistEntry.create({ data: data as never }) as never
  },
  async findWaitlistEntryByEmail(email) {
    return rawDb.waitlistEntry.findUnique({ where: { email } }) as never
  },
  async findWaitlistEntries(status) {
    return rawDb.waitlistEntry.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: 200,
    }) as never
  },
  async updateWaitlistEntry(id, data) {
    return rawDb.waitlistEntry.update({ where: { id }, data: data as never }) as never
  },
}

// Export the raw db for backward compatibility during migration
export { rawDb as db }
