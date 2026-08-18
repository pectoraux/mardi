import { NextRequest, NextResponse } from 'next/server'
import { getAIProvider } from '@/lib/infrastructure/composition/root'
import { db } from '@/lib/db'

// =============================================================================
// Marketing Growth Diagnostic — the public free tool (milestone 7, revised)
// =============================================================================
// Creates a DiagnosticRun (NOT a Prospect). The funnel is:
//   DiagnosticRun → IdentifiedOrganization → PotentialProspect → Prospect
// Promotion requires explicit operator action (prevents funnel inflation).

const DIAGNOSTIC_SYSTEM_PROMPT = `You are the MARDI Marketing Growth Diagnostic engine.

A prospect has provided their company information. Your job is to produce an
evidence-backed marketing growth diagnosis that demonstrates the value of the
MARDI platform — specifically its ability to distinguish causal from
correlational evidence.

ABSOLUTE RULES:
1. Do NOT fabricate financial metrics. If you don't know a number, say "not available from public information."
2. Do NOT claim private knowledge of the company's internal data.
3. Clearly distinguish OBSERVED (public signals) vs INFERRED (model-derived) vs PREDICTED (forecast) vs RECOMMENDED (suggestion).
4. Every recommendation must reference the evidence it's based on.
5. Be genuinely useful — this is not marketing fluff. Show real analytical thinking.

OUTPUT FORMAT (single JSON object):
{
  "company": "name",
  "observed": ["...publicly visible signals..."],
  "inferred": ["...what these signals suggest..."],
  "predicted": ["...what we expect is happening — with uncertainty stated..."],
  "opportunities": [
    {
      "title": "short title",
      "description": "the opportunity",
      "evidence": "what evidence supports this",
      "confidence": 0.0-1.0,
      "expectedImpact": "qualitative description"
    }
  ],
  "recommendedExperiments": [
    {
      "name": "experiment name",
      "hypothesis": "what we'd test",
      "methodology": "ab_test | holdout | geo | uplift | mmm",
      "why": "why this experiment would reduce uncertainty"
    }
  ],
  "uncertainty": "what we don't know and how confident we are overall",
  "nextStep": "the single most valuable next step for this company",
  "mardiFit": "why MARDI would specifically help this company (tied to evidence above)",
  "recommendedAngle": "the single best outreach angle if MARDI were to contact this company",
  "suggestedCTA": "the specific call-to-action that would resonate"
}`

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { company, website, industry, size, notes } = (body ?? {}) as {
    company?: string; website?: string; industry?: string; size?: string; notes?: string
  }
  if (!company) {
    return NextResponse.json({ error: 'company name required' }, { status: 400 })
  }

  const provider = getAIProvider()
  const userMessage = `Company: ${company}
Website: ${website ?? 'not provided'}
Industry: ${industry ?? 'not provided'}
Size: ${size ?? 'not provided'}
Additional notes: ${notes ?? 'none'}

Produce the marketing growth diagnosis as a single JSON object.`

  const result = await provider.complete({
    systemPrompt: DIAGNOSTIC_SYSTEM_PROMPT,
    userMessage,
    json: true,
    thinking: false,
  })

  // Record as a DiagnosticRun (NOT a Prospect). The operator must explicitly
  // promote it to Prospect after reviewing.
  let diagnosticRunId: string | null = null
  try {
    const mardi = await db.tenant.findUnique({ where: { slug: 'mardi_internal' } })
    if (mardi) {
      const dr = await db.diagnosticRun.create({
        data: {
          tenantId: mardi.id,
          company,
          website: website ?? null,
          industry: industry ?? null,
          size: size ?? null,
          notes: notes ?? null,
          diagnosis: JSON.stringify(result.parsed ?? result.content),
          provider: result.provider,
          model: result.model,
          fellBack: result.fellBack ?? false,
          stage: 'diagnostic_run',
        },
      })
      diagnosticRunId = dr.id
    }
  } catch (err) {
    console.error('[diagnostic] failed to record run:', err)
  }

  return NextResponse.json({
    diagnosis: result.parsed ?? result.content,
    provider: result.provider,
    model: result.model,
    fellBack: result.fellBack ?? false,
    generatedAt: new Date().toISOString(),
    diagnosticRunId,
  })
}
