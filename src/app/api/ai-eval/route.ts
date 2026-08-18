import { NextRequest, NextResponse } from 'next/server'
import { runEvaluation } from '@/lib/platform/ai-eval'

// POST /api/ai-eval — runs the AI evaluation framework and returns results
// This is NOT a mock — it runs the real Strategy Agent against real test cases.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const tenantSlug = (body ?? {}).tenantSlug as string | undefined

  try {
    const report = await runEvaluation({ tenantSlug })
    return NextResponse.json(report)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'evaluation failed' },
      { status: 500 }
    )
  }
}

// GET — returns the test case catalog (without running them)
export async function GET() {
  return NextResponse.json({
    testCases: await import('@/lib/platform/ai-eval').then((m) =>
      m.TEST_CASES.map((tc) => ({
        id: tc.id,
        category: tc.category,
        name: tc.name,
        description: tc.description,
        tenantSlug: tc.tenantSlug,
        assertionCount: tc.assertions.length,
      }))
    ),
  })
}
