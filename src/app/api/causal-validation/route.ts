import { NextResponse } from 'next/server'
import { runCausalValidation } from '@/lib/intelligence/causal-validation'

export async function POST() {
  const report = await runCausalValidation()
  return NextResponse.json(report)
}
