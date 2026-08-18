import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { executeAction, type ExecutionRequest } from '@/lib/execution/pipeline'

// POST /api/execution — execute an action through the real pipeline
export const POST = withTenant(async (req: NextRequest, _ctx) => {
  const body = await req.json().catch(() => ({}))
  const execReq = body as ExecutionRequest

  if (!execReq.actionType || !execReq.provider || !execReq.operation) {
    return NextResponse.json(
      { error: 'actionType, provider, and operation required' },
      { status: 400 }
    )
  }

  const result = await executeAction(execReq)
  return NextResponse.json(result)
})
