import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { runStrategyAgent } from '@/lib/agents/strategy-agent'

export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const prompt = body.prompt
  if (!prompt || typeof prompt !== 'string') {
    return NextResponse.json({ error: 'prompt required' }, { status: 400 })
  }
  const history = Array.isArray(body.history) ? body.history : undefined
  const out = await runStrategyAgent({ prompt, history })
  return NextResponse.json(out)
})
