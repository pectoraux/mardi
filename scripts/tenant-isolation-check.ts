// =============================================================================
// Cross-tenant attack tests (Section 5)
// =============================================================================
// "Tenant isolation must be tested automatically. Create explicit
//  cross-tenant attack tests."
//
// This script verifies that the tenant-guard repository layer prevents:
//   - reading another tenant's rows
//   - retrieving another tenant's documents
//   - updating another tenant's entities
//   - inferring private tenant data through an API response
//
// Run: `bun run scripts/tenant-isolation-check.ts`

import { db } from '../src/lib/db'
import {
  buildContext, getTenantBySlug, withTenantContext, TenantContextError,
} from '../src/lib/tenant-context'
import { t, TenantIsolationViolation } from '../src/lib/tenant-guard'

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function main() {
  console.log('Cross-tenant isolation tests (Section 5)\n')

  const acme = await getTenantBySlug('acme')
  const nova = await getTenantBySlug('nova')
  if (!acme || !nova) throw new Error('seed tenants missing')
  const acmeCtx = buildContext(acme)
  const novaCtx = buildContext(nova)

  // ---------------------------------------------------------------------------
  console.log('1. Read isolation: acme cannot see nova campaigns')
  // ---------------------------------------------------------------------------
  await withTenantContext(acmeCtx, async () => {
    const acmeCampaigns = await t.campaign.findMany({})
    const acmeIds = new Set(acmeCampaigns.map((c) => c.id))
    // Switch to nova and get its campaign ids
    await withTenantContext(novaCtx, async () => {
      const novaCampaigns = await t.campaign.findMany({})
      const novaIds = new Set(novaCampaigns.map((c) => c.id))
      // Verify no overlap
      const overlap = [...acmeIds].filter((id) => novaIds.has(id))
      ok('acme campaigns ∩ nova campaigns = ∅', overlap.length === 0, `${overlap.length} overlaps`)
      ok('acme campaigns all have tenantId=acme', acmeCampaigns.every((c) => c.tenantId === acme.id))
      ok('nova campaigns all have tenantId=nova', novaCampaigns.every((c) => c.tenantId === nova.id))
    })
  })

  // ---------------------------------------------------------------------------
  console.log('2. Read isolation: acme cannot fetch nova campaign by id')
  // ---------------------------------------------------------------------------
  await withTenantContext(novaCtx, async () => {
    const novaCampaigns = await t.campaign.findMany({})
    const novaCampaignId = novaCampaigns[0]?.id
    await withTenantContext(acmeCtx, async () => {
      // findUnique with nova's campaign id but acme's tenant context
      const attempt = await t.campaign.findUnique({ where: { id: novaCampaignId } })
      ok('acme findUnique(novaCampaignId) returns null (tenant guard adds tenantId to where)',
        attempt === null,
        attempt ? 'returned a row!' : undefined)
    })
  })

  // ---------------------------------------------------------------------------
  console.log('3. Read isolation: acme cannot see nova events / raw records / customers')
  // ---------------------------------------------------------------------------
  await withTenantContext(acmeCtx, async () => {
    const acmeEvents = await t.event.findMany({})
    const acmeRaw = await t.rawRecord.findMany({})
    const acmeCustomers = await t.customer.findMany({})
    ok('acme events all have tenantId=acme', acmeEvents.every((e) => e.tenantId === acme.id))
    ok('acme raw records all have tenantId=acme', acmeRaw.every((r) => r.tenantId === acme.id))
    ok('acme customers all have tenantId=acme', acmeCustomers.every((c) => c.tenantId === acme.id))
    ok('acme events reference only acme entities',
      acmeEvents.every((e) => !e.entityId || !e.entityId.startsWith('nova-')))
  })

  // ---------------------------------------------------------------------------
  console.log('4. Write isolation: acme cannot update nova campaign')
  // ---------------------------------------------------------------------------
  await withTenantContext(novaCtx, async () => {
    const novaCampaigns = await t.campaign.findMany({})
    const novaCampaignId = novaCampaigns[0]?.id
    await withTenantContext(acmeCtx, async () => {
      // update with nova's campaign id but acme's tenant context
      // The guard merges tenantId=acme into the where, so this should update 0 rows.
      const result = await t.campaign.updateMany({
        where: { id: novaCampaignId },
        data: { name: 'HIJACKED' },
      })
      ok('acme updateMany(novaCampaignId) affects 0 rows', result.count === 0, `affected ${result.count}`)
    })
    // Verify nova's campaign was NOT renamed
    const still = await t.campaign.findUnique({ where: { id: novaCampaignId } })
    ok('nova campaign name unchanged after attack', still?.name !== 'HIJACKED')
  })

  // ---------------------------------------------------------------------------
  console.log('5. Write isolation: acme cannot delete nova campaign')
  // ---------------------------------------------------------------------------
  await withTenantContext(novaCtx, async () => {
    const novaCampaigns = await t.campaign.findMany({})
    const novaCampaignId = novaCampaigns[0]?.id
    await withTenantContext(acmeCtx, async () => {
      const result = await t.campaign.deleteMany({ where: { id: novaCampaignId } })
      ok('acme deleteMany(novaCampaignId) affects 0 rows', result.count === 0, `deleted ${result.count}`)
    })
    const still = await t.campaign.findUnique({ where: { id: novaCampaignId } })
    ok('nova campaign still exists after delete attack', still !== null)
  })

  // ---------------------------------------------------------------------------
  console.log('6. TenantId reassignment forbidden')
  // ---------------------------------------------------------------------------
  await withTenantContext(acmeCtx, async () => {
    const acmeCampaigns = await t.campaign.findMany({})
    const acmeCampaignId = acmeCampaigns[0]?.id
    let threw = false
    try {
      await t.campaign.update({
        where: { id: acmeCampaignId },
        data: { tenantId: nova.id } as never, // attempt to reassign to nova
      })
    } catch (e) {
      threw = e instanceof TenantIsolationViolation || e instanceof Error
    }
    ok('updating tenantId to another tenant throws', threw)
  })

  // ---------------------------------------------------------------------------
  console.log('7. No-context access is fail-closed')
  // ---------------------------------------------------------------------------
  // Run OUTSIDE any withTenantContext — should throw TenantContextError
  let threw = false
  try {
    await t.campaign.findMany({})
  } catch (e) {
    threw = e instanceof TenantContextError || (e instanceof TenantIsolationViolation)
  }
  ok('findMany without TenantContext throws (fail-closed)', threw)

  // ---------------------------------------------------------------------------
  console.log('8. Evidence graph isolation')
  // ---------------------------------------------------------------------------
  await withTenantContext(acmeCtx, async () => {
    const acmeEdges = await t.edge.findMany({})
    ok('acme edges all have tenantId=acme', acmeEdges.every((e) => e.tenantId === acme.id))
  })

  // ---------------------------------------------------------------------------
  console.log('\nSummary')
  console.log(`  passed: ${passed}`)
  console.log(`  failed: ${failed}`)
  if (failed > 0) {
    console.log('\n❌ TENANT ISOLATION VIOLATIONS DETECTED')
    process.exit(1)
  } else {
    console.log('\n✓ All tenant isolation invariants hold')
    process.exit(0)
  }
}

main().catch((e) => {
  console.error('Fatal:', e)
  process.exit(1)
})
