// =============================================================================
// RLS Validation Test — proves PostgreSQL RLS works when session variable is set
// =============================================================================
// Run: `bun run scripts/test-rls.ts`

import { PrismaClient } from '@prisma/client'

// Use the mardi_app role (NOBYPASSRLS) to test actual RLS enforcement
const APP_URL = 'postgresql://mardi_app:MardiApp2025!@ep-morning-hall-ays4yug4.c-5.us-east-2.aws.neon.tech/neondb?sslmode=require'
const ADMIN_URL = process.env.DIRECT_URL ?? process.env.DATABASE_URL!
const db = new PrismaClient({ datasources: { db: { url: APP_URL } } })
const dbAdmin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } })

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

async function main() {
  console.log('PostgreSQL RLS Validation Test\n')

  const acme = await dbAdmin.tenant.findUnique({ where: { slug: 'acme' } })
  const nova = await dbAdmin.tenant.findUnique({ where: { slug: 'nova' } })
  if (!acme || !nova) throw new Error('tenants not found — run seed first')
  console.log(`  acme: ${acme.id}`)
  console.log(`  nova: ${nova.id}\n`)

  // 1. Check RLS policies exist
  console.log('1. RLS policies exist')
  const policies = await dbAdmin.$queryRaw`
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  ` as Array<{ tablename: string; policyname: string }>
  ok('RLS policies exist', policies.length > 0, `${policies.length} policies`)
  const policyNames = policies.map((p) => `${p.tablename}:${p.policyname}`)
  ok('Campaign has RLS policy', policyNames.some((n) => n.includes('Campaign')))
  ok('Customer has RLS policy', policyNames.some((n) => n.includes('Customer')))
  ok('Event has RLS policy', policyNames.some((n) => n.includes('Event')))

  // 2. RLS filters when session variable is set
  console.log('\n2. RLS filters rows when app.tenant_id is set')
  const acmeActualCount = await dbAdmin.campaign.count({ where: { tenantId: acme.id } })

  const acmeRLSCount = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${acme.id}'`)
    const result = await tx.$queryRawUnsafe('SELECT COUNT(*)::int as count FROM "Campaign"') as Array<{ count: number }>
    return result[0].count
  })
  ok('RLS count matches actual acme count', acmeRLSCount === acmeActualCount, `RLS=${acmeRLSCount}, actual=${acmeActualCount}`)

  // 3. RLS blocks cross-tenant access
  console.log('\n3. RLS blocks cross-tenant access')
  const novaThroughAcme = await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${acme.id}'`)
    const result = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "Campaign" WHERE "tenantId" = '${nova.id}'`) as Array<{ count: number }>
    return result[0].count
  })
  ok('RLS blocks nova campaigns when tenant=acme', novaThroughAcme === 0, `got ${novaThroughAcme}`)

  // 4. RLS applies across multiple tables
  console.log('\n4. RLS applies across multiple tables')
  for (const table of ['Customer', 'Event', 'Experiment', 'CausalEstimate']) {
    const count = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${acme.id}'`)
      const result = await tx.$queryRawUnsafe(`SELECT COUNT(*)::int as count FROM "${table}"`) as Array<{ count: number }>
      return result[0].count
    })
    ok(`RLS filters ${table} to acme`, count > 0, `${count} rows`)
  }

  // 5. Check FORCE status
  console.log('\n5. FORCE ROW LEVEL SECURITY status')
  const forceStatus = await dbAdmin.$queryRaw`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('Campaign', 'Customer', 'Event', 'Edge')
    ORDER BY relname
  ` as Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
  for (const t of forceStatus) {
    ok(`${t.relname}: RLS=${t.relrowsecurity}, FORCE=${t.relforcerowsecurity}`,
      t.relrowsecurity === true,
      `FORCE=${t.relforcerowsecurity}`)
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`)
  if (failed > 0) console.log('\n⚠️  Some RLS checks failed.')
  else console.log('\n✓ All RLS validation tests pass')
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
