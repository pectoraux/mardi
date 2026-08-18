// =============================================================================
// Seed — two tenants with full demo data for the MVP vertical slice.
// =============================================================================
//   tenant:acme  (Acme Coffee Co.)   — standard pooled tenant
//   tenant:nova  (Nova Skincare)     — second tenant (isolation attack target)
//   admin user:  ekontetevi@gmail / Payswap123456
//   demo users:  demo accounts with quick-login links
//
// Run: `bun run scripts/seed.ts`

import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

const DEMO_PASSWORD = 'Demo1234!'

async function main() {
  console.log('Resetting database…')
  // Clean slate (order matters for FK constraints).
  const tables = [
    'auditLog', 'agentToolCall', 'agentRun', 'workflowStep', 'workflow',
    'approval', 'decision', 'recommendation', 'causalEstimate', 'experiment',
    'edge', 'event', 'rawRecord', 'interaction', 'ad', 'adSet', 'creative',
    'campaign', 'audience', 'customer', 'product', 'brand', 'connector',
    'secretRef', 'policy', 'user', 'waitlistEntry', 'organization', 'tenant',
  ]
  for (const name of tables) {
    // @ts-expect-error dynamic model
    await db[name].deleteMany({})
  }

  // Hash passwords
  const adminHash = await bcrypt.hash('Payswap123456', 12)
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 12)

  console.log('Creating tenants…')
  const acme = await db.tenant.create({
    data: {
      slug: 'acme',
      name: 'Acme Coffee Co.',
      plan: 'standard',
      region: 'us-east-1',
      autonomyLevel: 2,
      isolationMode: 'pooled',
      learningOptIn: true,
    },
  })
  const nova = await db.tenant.create({
    data: {
      slug: 'nova',
      name: 'Nova Skincare',
      plan: 'enterprise',
      region: 'eu-west-1',
      autonomyLevel: 1,
      isolationMode: 'pooled',
      learningOptIn: false,
    },
  })

  // --- Real admin user (ekontetevi@gmail / Payswap123456) ---
  await db.user.create({
    data: {
      email: 'ekontetevi@gmail',
      name: 'Admin',
      password: adminHash,
      roles: 'admin',
      tenantId: null, // admin spans all tenants
      isDemo: false,
      isActive: true,
    },
  })

  // --- Demo accounts (password: Demo1234!) ---
  await db.user.create({
    data: {
      email: 'demo.acme@mdip.demo',
      name: 'Demo — Acme Marketer',
      password: demoHash,
      roles: 'marketer',
      tenantId: acme.id,
      isDemo: true,
      isActive: true,
    },
  })
  await db.user.create({
    data: {
      email: 'demo.cmo@mdip.demo',
      name: 'Demo — Acme CMO',
      password: demoHash,
      roles: 'cmo,marketer',
      tenantId: acme.id,
      isDemo: true,
      isActive: true,
    },
  })
  await db.user.create({
    data: {
      email: 'demo.nova@mdip.demo',
      name: 'Demo — Nova Marketer',
      password: demoHash,
      roles: 'marketer',
      tenantId: nova.id,
      isDemo: true,
      isActive: true,
    },
  })
  await db.user.create({
    data: {
      email: 'demo.admin@mdip.demo',
      name: 'Demo — Admin',
      password: demoHash,
      roles: 'admin',
      tenantId: null,
      isDemo: true,
      isActive: true,
    },
  })

  for (const tenant of [acme, nova]) {
    await seedTenant(tenant)
  }

  console.log('Seed complete.')
  console.log('  tenants:', acme.slug, nova.slug)
  console.log('  admin:   ekontetevi@gmail / Payswap123456')
  console.log('  demo:    demo.acme@mdip.demo / demo.cmo@mdip.demo / demo.nova@mdip.demo / demo.admin@mdip.demo')
  console.log('  demo password: Demo1234!')
}

async function seedTenant(tenant: { id: string; slug: string; name: string }) {
  const tid = tenant.id

  // Organization + policy (seed users with login are created above)
  const org = await db.organization.create({
    data: { tenantId: tid, name: tenant.name },
  })
  await db.policy.create({
    data: {
      tenantId: tid,
      name: 'default',
      maxSpendChangePct: 15,
      allowedChannels: 'google_ads,meta,email',
      allowedActions: 'pause,publish_draft,create_experiment',
      requiresApproval: true,
      riskThreshold: 0.35,
      operatingHours: '00-24',
    },
  })

  // Brands + products
  const isAcme = tenant.slug === 'acme'
  const brand = await db.brand.create({
    data: {
      tenantId: tid,
      name: tenant.name,
      category: isAcme ? 'consumer goods / coffee' : 'beauty / skincare',
      description: isAcme
        ? 'DTC specialty coffee roaster selling beans, subscriptions and brewing equipment.'
        : 'Premium science-led skincare brand sold DTC and via Sephora.',
    },
  })
  const products = isAcme
    ? [
        { name: 'Single Origin Ethiopia (250g)', price: 18 },
        { name: 'Cold Brew Concentrate (1L)', price: 24 },
        { name: 'Monthly Subscription — 2 bags', price: 32 },
        { name: 'V60 Starter Kit', price: 65 },
      ]
    : [
        { name: 'Vitamin C Brightening Serum', price: 48 },
        { name: 'Retinol Night Cream', price: 62 },
        { name: 'Hydrating Cleanser', price: 28 },
        { name: 'Glow Set (Serum + Cream)', price: 95 },
      ]
  for (const p of products) {
    await db.product.create({
      data: { tenantId: tid, brandId: brand.id, name: p.name, price: p.price },
    })
  }

  // Connectors (mock Google Ads + Shopify)
  const googleAds = await db.connector.create({
    data: {
      tenantId: tid,
      type: 'google_ads',
      name: 'Google Ads — primary account',
      status: 'connected',
      config: JSON.stringify({ accountId: `G-${tenant.slug.toUpperCase()}-001`, currency: 'USD' }),
      secretRefId: null,
    },
  })
  const shopify = await db.connector.create({
    data: {
      tenantId: tid,
      type: 'shopify',
      name: 'Shopify — DTC store',
      status: 'connected',
      config: JSON.stringify({ shop: `${tenant.slug}.myshopify.com` }),
      secretRefId: null,
    },
  })

  // Audiences
  await db.audience.create({
    data: {
      tenantId: tid,
      name: 'High-LTV Repeat Buyers',
      description: 'Customers with 3+ purchases and LTV > $150',
      size: isAcme ? 4200 : 2800,
      criteria: JSON.stringify({ segment: 'returning', ltv_min: 150, orders_min: 3 }),
    },
  })
  await db.audience.create({
    data: {
      tenantId: tid,
      name: 'New Acquirers (30d)',
      description: 'First-time purchasers in last 30 days',
      size: isAcme ? 1850 : 1320,
      criteria: JSON.stringify({ segment: 'new', first_purchase_days: 30 }),
    },
  })

  // Creatives
  const creativeA = await db.creative.create({
    data: {
      tenantId: tid,
      brandId: brand.id,
      name: isAcme ? 'Bright Mornings — Ethiopia' : 'Glow in 14 Days',
      format: 'image',
      channel: 'google_ads',
      hook: isAcme ? 'Tired of bitter coffee?' : 'Dull skin in 2025?',
      promise: isAcme ? 'Bright, fruity single-origin — roasted to order' : 'Visibly brighter skin in 14 days',
      cta: 'Shop now',
    },
  })
  const creativeB = await db.creative.create({
    data: {
      tenantId: tid,
      brandId: brand.id,
      name: isAcme ? 'Subscription Savings' : 'Retinol Done Right',
      format: 'image',
      channel: 'meta',
      hook: isAcme ? 'Never run out again' : 'Smarter retinol, no redness',
      promise: isAcme ? 'Save 15% + free shipping on subscriptions' : 'Encapsulated retinol — gentle, effective',
      cta: 'Start subscription',
    },
  })

  // Campaigns + adsets + ads
  const camp1 = await db.campaign.create({
    data: {
      tenantId: tid,
      brandId: brand.id,
      externalId: `camp-${tenant.slug}-1`,
      name: isAcme ? 'Q4 Prospecting — Search' : 'Q4 Prospecting — Meta',
      channel: isAcme ? 'google_ads' : 'meta',
      status: 'active',
      objective: 'conversion',
      budget: isAcme ? 25000 : 40000,
      spent: isAcme ? 18200 : 31400,
      startDate: new Date('2025-10-01'),
      endDate: new Date('2025-12-31'),
    },
  })
  const camp2 = await db.campaign.create({
    data: {
      tenantId: tid,
      brandId: brand.id,
      externalId: `camp-${tenant.slug}-2`,
      name: isAcme ? 'Subscription Retention — Email' : 'Glow Set Bundle — Search',
      channel: 'email',
      status: 'active',
      objective: 'retention',
      budget: 5000,
      spent: 2100,
      startDate: new Date('2025-09-15'),
    },
  })
  const adset1 = await db.adSet.create({
    data: { tenantId: tid, campaignId: camp1.id, name: 'Prospecting — Broad', bid: 1.2 },
  })
  await db.ad.create({
    data: { tenantId: tid, adsetId: adset1.id, creativeId: creativeA.id, name: 'Ad A — Bright Mornings', status: 'active' },
  })
  await db.ad.create({
    data: { tenantId: tid, adsetId: adset1.id, creativeId: creativeB.id, name: 'Ad B — Subscription', status: 'paused' },
  })

  // Customers + interactions (synthetic but realistic) — bulk insert for speed
  const now = new Date()
  const segs = ['new', 'returning', 'vip', 'churned']
  const customerData: Array<Record<string, unknown>> = []
  for (let i = 0; i < 80; i++) {
    const seg = segs[i % segs.length]
    const ltv =
      seg === 'vip' ? 250 + Math.random() * 400 :
      seg === 'returning' ? 80 + Math.random() * 120 :
      seg === 'churned' ? 20 + Math.random() * 60 :
      10 + Math.random() * 40
    customerData.push({
      tenantId: tid,
      externalId: `${tenant.slug}-cust-${i}`,
      email: `user${i}@${tenant.slug}.example`,
      name: `Customer ${i}`,
      segment: seg,
      ltv: Math.round(ltv),
      createdAt: new Date(now.getTime() - (60 - i) * 86400_000),
    })
  }
  const customers = await db.customer.createMany({ data: customerData, skipDuplicates: true })
  // Fetch created customers to get their IDs for interactions
  const createdCustomers = await db.customer.findMany({ where: { tenantId: tid }, select: { id: true, externalId: true } })
  const interactionData: Array<Record<string, unknown>> = []
  for (const c of createdCustomers) {
    const n = 3 + Math.floor(Math.random() * 4)
    for (let j = 0; j < n; j++) {
      const type = j === 0 ? 'impression' : j === 1 ? 'click' : j === 2 ? 'visit' : j === 3 ? 'lead' : 'purchase'
      const value = type === 'purchase' ? 20 + Math.random() * 80 : 0
      const occurred = new Date(now.getTime() - (40 - j * 3 - (createdCustomers.indexOf(c) % 7)) * 86400_000)
      interactionData.push({
        tenantId: tid,
        customerId: c.id,
        type,
        value,
        occurredAt: occurred,
        source: j % 2 === 0 ? 'google_ads' : 'shopify',
        lineageId: randomUUID(),
      })
    }
  }
  await db.interaction.createMany({ data: interactionData, skipDuplicates: true })
  void customers

  // Experiment + causal estimate (the killer evidence)
  const exp = await db.experiment.create({
    data: {
      tenantId: tid,
      campaignId: camp1.id,
      name: isAcme
        ? 'Cold Brew Creative Holdout (Q4)'
        : 'Retinol Cream — Benefit Lead vs Feature Lead',
      hypothesis: isAcme
        ? 'Lead-with-benefit creative outperforms lead-with-product creative on Cold Brew conversions.'
        : 'Benefit-led creative increases add-to-cart rate vs feature-led creative.',
      objective: 'Lift conversion rate on Cold Brew / Retinol product page',
      population: JSON.stringify({ segment: 'prospecting', geo: 'US', size: 120000 }),
      primaryMetric: 'conversions',
      secondaryMetrics: JSON.stringify(['roas', 'ctr', 'cpm']),
      guardrailMetrics: JSON.stringify(['cac', 'brand_search_lift']),
      methodology: 'ab_test',
      status: 'analyzed',
      sampleSize: 60000,
      durationDays: 21,
      startDate: new Date('2025-09-01'),
      endDate: new Date('2025-09-22'),
      decision: 'ship',
      learning: isAcme
        ? 'Benefit-led creative lifted conversions +18% (95% CI [11%, 25%]); ship to 100% of prospecting budget.'
        : 'Benefit-led creative lifted add-to-cart +12% (95% CI [6%, 18%]); ship with 4-week monitoring.',
    },
  })
  const lift = isAcme ? 0.18 : 0.12
  const effectAbs = isAcme ? 142 : 96
  await db.causalEstimate.create({
    data: {
      tenantId: tid,
      experimentId: exp.id,
      campaignId: camp1.id,
      metric: 'conversions',
      treatment: 'benefit_led_creative',
      control: 'feature_led_creative',
      methodology: 'ab_test',
      effectSize: effectAbs,
      effectSizePct: lift,
      uncertaintyLow: lift - 0.07,
      uncertaintyHigh: lift + 0.07,
      confidence: 0.95,
      population: JSON.stringify({ size: 60000, geo: 'US' }),
      observationWindowDays: 21,
      assumptions: JSON.stringify(['SUTVA holds', 'Stable Unit Treatment Value', 'No interference between arms']),
      modelVersion: 'ab-test-v1',
      sourceData: JSON.stringify({ experimentId: exp.id, rawConnector: googleAds.id }),
    },
  })
  // A second causal estimate — geo MMM style
  await db.causalEstimate.create({
    data: {
      tenantId: tid,
      campaignId: camp1.id,
      metric: 'revenue',
      treatment: 'google_ads_spend',
      control: 'holdout_geo',
      methodology: 'geo_experiment',
      effectSize: isAcme ? 38500 : 52400,
      effectSizePct: isAcme ? 0.23 : 0.17,
      uncertaintyLow: isAcme ? 0.14 : 0.09,
      uncertaintyHigh: isAcme ? 0.32 : 0.25,
      confidence: 0.82,
      population: JSON.stringify({ geo: 'US', dmAs: 12 }),
      observationWindowDays: 28,
      assumptions: JSON.stringify(['Stable geography preferences', 'No concurrent promo']),
      modelVersion: 'geo-mmm-v2',
      sourceData: JSON.stringify({ connector: googleAds.id }),
    },
  })

  // Evidence graph edges (Section 11)
  const recId = `pending` // recommendations created by decision engine later
  void recId
  await db.edge.create({
    data: {
      tenantId: tid,
      sourceType: 'Experiment',
      sourceId: exp.id,
      relation: 'produced',
      targetType: 'CausalEstimate',
      targetId: 'causal-1',
      weight: 1,
      metadata: JSON.stringify({ note: 'primary causal estimate from experiment' }),
    },
  })

  // A few events (the bus will create more on sync)
  await db.event.create({
    data: {
      eventId: `${tid}:seed:experiment_completed_${exp.id}`,
      tenantId: tid,
      eventType: 'experiment_completed',
      entityType: 'Experiment',
      entityId: exp.id,
      source: 'experiment_service',
      occurredAt: new Date('2025-09-23T10:00:00Z'),
      schemaVersion: 1,
      payload: JSON.stringify({ experimentId: exp.id, decision: 'ship', lift }),
      lineageId: randomUUID(),
    },
  })

  // Workflow (a completed research-to-launch example)
  const wf = await db.workflow.create({
    data: {
      tenantId: tid,
      type: 'research_to_launch',
      status: 'completed',
      input: JSON.stringify({ brief: isAcme ? 'Q4 Cold Brew push' : 'Q4 Retinol push' }),
      output: JSON.stringify({ launchedCampaignId: camp1.id }),
    },
  })
  for (const [idx, stepName] of [
    'research', 'strategy', 'brief', 'creative', 'approval', 'launch', 'monitor', 'measure', 'analyze', 'learn',
  ].entries()) {
    await db.workflowStep.create({
      data: {
        workflowId: wf.id,
        name: stepName,
        status: 'completed',
        attempt: 1,
        startedAt: new Date(Date.now() - (10 - idx) * 86400_000),
        finishedAt: new Date(Date.now() - (10 - idx) * 86400_000 + 3_600_000),
      },
    })
  }

  // Audit log entries
  await db.auditLog.create({
    data: {
      tenantId: tid,
      actorType: 'system',
      action: 'seed.import',
      entityType: 'Tenant',
      entityId: tid,
      detail: JSON.stringify({ source: 'scripts/seed.ts' }),
    },
  })

  console.log(`  seeded ${tenant.slug}: ${products.length} products, 2 campaigns, 1 experiment, 2 causal estimates, 80 customers`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
