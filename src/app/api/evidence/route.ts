import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { getEvidenceChain, getFullGraph } from '@/lib/intelligence/evidence-graph'

export const GET = withTenant(async (req: NextRequest, _ctx) => {
  const type = req.nextUrl.searchParams.get('type') ?? undefined
  const id = req.nextUrl.searchParams.get('id') ?? undefined
  if (type && id) {
    const chain = await getEvidenceChain({ type, id })
    return NextResponse.json(chain)
  }
  const graph = await getFullGraph(500)
  return NextResponse.json(graph)
})
