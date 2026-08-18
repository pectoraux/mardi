// =============================================================================
// Capability Registry — the system knows what infrastructure is available
// =============================================================================
// Section 43 of the frozen architecture. The application uses capabilities
// rather than hardcoding provider assumptions. Example:
//   if (capabilities.supports('paid_inference')) usePaidModel()
//   else useLocalFallback()

export type Capability =
  | 'bootstrap'           // SQLite/Postgres, in-process event bus, local model
  | 'postgres_rls'        // PostgreSQL with Row Level Security
  | 'kafka_events'        // durable Kafka/Redpanda event backbone
  | 'temporal_workflows'  // Temporal workflow engine
  | 'dedicated_vector'    // dedicated vector DB (Pinecone, Weaviate, etc.)
  | 'dedicated_graph'     // dedicated graph DB (Neo4j, etc.)
  | 'object_storage'      // S3/R2 object storage
  | 'lakehouse'           // Iceberg + Trino/Spark analytics
  | 'paid_inference'      // paid LLM API (zai/openai/anthropic)
  | 'payment_verification' // Stripe/PayPal payment verification
  | 'email_delivery'      // real email delivery (SendGrid, etc.)
  | 'enterprise_kms'      // dedicated encryption keys
  | 'data_residency'      // region-pinned data
  | 'sso'                 // OIDC/SAML SSO
  | 'scim'                // SCIM user provisioning
  | 'dedicated_tenant'    // dedicated infrastructure per tenant

export interface CapabilityRegistry {
  supports(capability: Capability): boolean
  list(): Capability[]
  /** Entitlement-gated: does this tenant's plan include this capability? */
  tenantSupports(ctx: { tenantId: string; plan: string }, capability: Capability): boolean
}

// Bootstrap capability set — always available, zero infrastructure cost
const BOOTSTRAP_CAPABILITIES: Capability[] = [
  'bootstrap',
  'postgres_rls', // we're on Postgres (Neon) — RLS can be enabled
  'object_storage', // R2/S3 available via env
  'paid_inference', // z-ai SDK available
]

// Plan-based entitlements (Section 44)
const PLAN_CAPABILITIES: Record<string, Capability[]> = {
  free: ['bootstrap', 'paid_inference'],
  growth: ['bootstrap', 'postgres_rls', 'paid_inference', 'email_delivery'],
  pro: [
    'bootstrap', 'postgres_rls', 'paid_inference', 'email_delivery',
    'object_storage', 'payment_verification', 'lakehouse',
  ],
  enterprise: [
    'bootstrap', 'postgres_rls', 'paid_inference', 'email_delivery',
    'object_storage', 'payment_verification', 'lakehouse',
    'dedicated_tenant', 'enterprise_kms', 'data_residency', 'sso', 'scim',
    'kafka_events', 'temporal_workflows',
  ],
}

class DefaultCapabilityRegistry implements CapabilityRegistry {
  private active: Set<Capability>

  constructor() {
    this.active = new Set(BOOTSTRAP_CAPABILITIES)
    // Add capabilities based on env vars
    if (process.env.STRIPE_SECRET_KEY) this.active.add('payment_verification')
    if (process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY) this.active.add('email_delivery')
    if (process.env.KAFKA_BROKERS) this.active.add('kafka_events')
    if (process.env.TEMPORAL_ADDRESS) this.active.add('temporal_workflows')
    if (process.env.PINECONE_API_KEY || process.env.WEAVIATE_URL) this.active.add('dedicated_vector')
    if (process.env.NEO4J_URI) this.active.add('dedicated_graph')
    if (process.env.S3_BUCKET || process.env.R2_BUCKET) this.active.add('object_storage')
  }

  supports(capability: Capability): boolean {
    return this.active.has(capability)
  }

  list(): Capability[] {
    return Array.from(this.active).sort()
  }

  tenantSupports(ctx: { tenantId: string; plan: string }, capability: Capability): boolean {
    const planCaps = PLAN_CAPABILITIES[ctx.plan] ?? PLAN_CAPABILITIES.free
    return planCaps.includes(capability) && this.supports(capability)
  }
}

let _registry: CapabilityRegistry | null = null

export function getCapabilityRegistry(): CapabilityRegistry {
  if (!_registry) _registry = new DefaultCapabilityRegistry()
  return _registry
}

export function setCapabilityRegistry(registry: CapabilityRegistry): void {
  _registry = registry
}

export { PLAN_CAPABILITIES }
