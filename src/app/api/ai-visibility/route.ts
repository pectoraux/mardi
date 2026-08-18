import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { getAIProvider } from '@/lib/infrastructure/composition/root'
import { createAIVisibilityService } from '@/lib/intelligence/ai-visibility'

// POST /api/ai-visibility — observe AI system response for a brand
export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: string }

  const llm = getAIProvider()
  const service = createAIVisibilityService(llm)

  if (action === 'report') {
    const report = await service.getReport(_ctx, body.brand)
    return NextResponse.json(report)
  }

  // Default: observe
  const observation = await service.observe(_ctx, {
    brand: body.brand,
    query: body.query,
    aiSystem: body.aiSystem,
    competitors: body.competitors,
  })
  return NextResponse.json(observation)
})

// GET — list observations
export const GET = withTenant(async (req: NextRequest, _ctx) => {
  const llm = getAIProvider()
  const service = createAIVisibilityService(llm)
  const brand = req.nextUrl.searchParams.get('brand') ?? undefined
  const observations = await service.listObservations(_ctx, { brand, limit: 50 })
  return NextResponse.json({ observations })
})
