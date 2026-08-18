import { NextRequest, NextResponse } from 'next/server'
import { withTenant } from '@/lib/middleware-tenant'
import { generateOutreachDraft } from '@/lib/agents/outreach-agent'

// POST /api/growth/prospects/[id]/draft — generate an outreach draft for a prospect
export const POST = withTenant(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  try {
    const result = await generateOutreachDraft({ prospectId: id })
    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
})
