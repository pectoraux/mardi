import { NextRequest, NextResponse } from 'next/server'
import { getAIProvider } from '@/lib/infrastructure/composition/root'
import { db } from '@/lib/db'

// =============================================================================
// Marketing Growth Diagnostic — the public free tool (milestone 7)
// =============================================================================
// This is MARDI's primary zero-capital acquisition asset. A prospect provides
// their company URL + industry + size, and the platform generates an
// evidence-backed diagnosis that clearly distinguishes:
//   OBSERVED   — what we can see from public information
//   INFERRED   — what we can model from those signals
//   PREDICTED  — what we expect to happen
//   RECOMMENDED — what they should do next
//
// The diagnostic does NOT fabricate financial metrics or claim private
// knowledge. It demonstrates the platform's core value (causal reasoning +
// evidence-first thinking) and creates a Prospect + GrowthExperiment
// exposure for MARDI_INTERNAL.
//
// This route is PUBLIC (no auth, no tenant header required) — it's the
// entry point for prospects.

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
  "observed": ["...publicly visible signals: website, positioning, likely channels, apparent spend levels..."],
  "inferred": ["...what these signals suggest about their marketing maturity, likely gaps, probable measurement approach..."],
  "predicted": ["...what we expect is happening to their incremental ROAS, saturation, attribution accuracy — with uncertainty stated..."],
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
  "mardiFit": "why MARDI would specifically help this company (tied to evidence above)"
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

  // Record this diagnostic as a Prospect + GrowthExperiment exposure
  // for the MARDI_INTERNAL tenant (the platform's own acquisition vehicle).
  try {
    const mardi = await db.tenant.findUnique({ where: { slug: 'mardi_internal' } })
    if (mardi) {
      // Find or create a "diagnostic_tool" growth experiment
      let exp = await db.growthExperiment.findFirst({
        where: { tenantId: mardi.id, acquisitionMechanism: 'free_tool' },
      })
      if (!exp) {
        exp = await db.growthExperiment.create({
          data: {
            tenantId: mardi.id,
            name: 'Marketing Growth Diagnostic — free tool',
            hypothesis: 'A free evidence-backed diagnostic tool will generate qualified leads who need MARDI’s causal intelligence.',
            acquisitionMechanism: 'free_tool',
            distributionChannel: 'organic',
            cost: 0,
            effortHours: 0,
            status: 'running',
            startDate: new Date(),
          },
        })
      }
      // Create prospect from the diagnostic
      await db.prospect.create({
        data: {
          tenantId: mardi.id,
          company,
          website: website ?? null,
          industry: industry ?? null,
          size: size ?? null,
          icpFitScore: 0.5, // will be refined by follow-up
          source: 'diagnostic_tool',
          growthExperimentId: exp.id,
          notes: `Ran diagnostic on ${new Date().toISOString()}. Notes: ${notes ?? 'none'}`,
        },
      })
      // Increment exposure
      await db.growthExperiment.update({
        where: { id: exp.id },
        data: { exposure: { increment: 1 } },
      })
    }
  } catch (err) {
    // Diagnostic recording is best-effort — don't fail the tool if DB is unavailable
    console.error('[diagnostic] failed to record prospect:', err)
  }

  return NextResponse.json({
    diagnosis: result.parsed ?? result.content,
    provider: result.provider,
    model: result.model,
    fellBack: result.fellBack ?? false,
    generatedAt: new Date().toISOString(),
  })
}
