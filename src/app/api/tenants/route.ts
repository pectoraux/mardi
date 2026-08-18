import { NextResponse } from 'next/server'
import { listTenants } from '@/lib/tenant-context'

// Public route — does NOT require a tenant context (it lists tenants).
export async function GET() {
  const tenants = await listTenants()
  return NextResponse.json({
    tenants: tenants.map((t) => ({
      slug: t.slug,
      name: t.name,
      plan: t.plan,
      region: t.region,
      autonomyLevel: t.autonomyLevel,
      learningOptIn: t.learningOptIn,
    })),
  })
}
