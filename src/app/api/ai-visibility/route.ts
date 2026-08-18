import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { getAIProvider } from '@/lib/infrastructure/composition/root'
import { createAIVisibilityService } from '@/lib/intelligence/ai-visibility'

// POST /api/ai-visibility — observe AI visibility
// body.source: 'real' (default) | 'simulated' | 'report'
export const POST = withTenant(async (req: NextRequest, { ctx }) => {
  const body = await req.json().catch(() => ({}))
  const { action, source } = body as { action?: string; source?: string }

  const llm = getAIProvider()
  const service = createAIVisibilityService(llm)

  if (action === 'report' || source === 'report') {
    const report = await service.getReport(ctx, body.brand)
    return NextResponse.json(report)
  }

  // Default: real observation (Level-3)
  if (source === 'simulated') {
    const observation = await service.observeSimulated(ctx, {
      brand: body.brand,
      query: body.query,
      aiSystem: body.aiSystem,
      competitors: body.competitors,
    })
    return NextResponse.json(observation)
  }

  // REAL external observation via web search
  try {
    const observation = await service.observeReal(ctx, {
      brand: body.brand,
      query: body.query,
      competitors: body.competitors,
      numResults: body.numResults,
    })
    return NextResponse.json(observation)
  } catch (err) {
    // If the real provider fails, return BLOCKED_EXTERNAL_PROVIDER (not a simulation)
    return NextResponse.json({
      error: 'BLOCKED_EXTERNAL_PROVIDER',
      detail: err instanceof Error ? err.message : 'web search provider unavailable',
      sourceType: 'real_external',
      status: 'blocked',
    }, { status: 503 })
  }
})

// GET — list observations
export const GET = withTenant(async (req: NextRequest, { ctx }) => {
  const llm = getAIProvider()
  const service = createAIVisibilityService(llm)
  const brand = req.nextUrl.searchParams.get('brand') ?? undefined
  const sourceType = req.nextUrl.searchParams.get('sourceType') ?? undefined
  const observations = await service.listObservations(ctx, { brand, sourceType, limit: 50 })
  return NextResponse.json({ observations })
})
