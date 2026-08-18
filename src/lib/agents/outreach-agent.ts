// =============================================================================
// Personalized Outreach Agent (milestone 3 — narrow operational loop)
// =============================================================================
// Generates a personalized outreach draft from the prospect's EXISTING
// evidence graph — it does NOT invent new claims. The draft has the exact
// structure the reviewer specified:
//   Why them
//   Problem observed
//   Why it matters
//   What MARDI can do
//   Specific offer
//   CTA
//   Evidence used
//   Confidence
//
// The draft is always created in 'draft' status. A human must approve it
// before it can be sent. No autonomous sending.

import { getAIProvider } from '../infrastructure/composition/root'
import { t } from '../tenant-guard'
import { getTenantContext } from '../tenant-context'
import type { LLMResult } from '../application/ports'

const OUTREACH_SYSTEM_PROMPT = `You are the MARDI Personalized Outreach Agent.

Your job: generate a concise, personalized outreach message for a prospect,
grounded ONLY in the evidence provided. You do NOT invent claims, metrics, or
private knowledge about the prospect's business.

ABSOLUTE RULES:
1. Every claim in the outreach must reference evidence provided to you.
2. Do NOT fabricate financial metrics or performance numbers.
3. Be concise — this is a cold/semi-warm outreach, not a sales deck.
4. The tone should be genuinely helpful, not pushy. We're demonstrating expertise, not selling.
5. If the evidence is weak, say so in the confidence field — don't pretend certainty.

OUTPUT FORMAT (single JSON object):
{
  "whyThem": "1-2 sentences on why this specific company was selected",
  "problemObserved": "the specific problem the evidence suggests they have",
  "whyItMatters": "why this problem matters for their business",
  "whatMardiCanDo": "how MARDI specifically addresses this (tied to evidence)",
  "specificOffer": "a concrete, low-friction offer (e.g. a free teardown, a 20-min diagnostic call)",
  "cta": "the specific call-to-action",
  "subjectLine": "a suggested email subject line (under 60 chars)",
  "body": "the full outreach email body (3-5 short paragraphs, plain text, no markdown)",
  "evidenceUsed": ["list of evidence items referenced, each with a 1-line summary"],
  "confidence": 0.0-1.0,
  "uncertainty": "what we're not sure about"
}`

export interface OutreachDraft {
  whyThem: string
  problemObserved: string
  whyItMatters: string
  whatMardiCanDo: string
  specificOffer: string
  cta: string
  subjectLine: string
  body: string
  evidenceUsed: string[]
  confidence: number
  uncertainty: string
}

export interface GenerateDraftInput {
  prospectId: string
}

export interface GenerateDraftOutput {
  outreachId: string
  draft: OutreachDraft
  provider: string
  model: string
  fellBack: boolean
}

export async function generateOutreachDraft(input: GenerateDraftInput): Promise<GenerateDraftOutput> {
  const ctx = getTenantContext()
  const provider = getAIProvider()

  // Load the prospect + all their evidence
  const prospect = await t.prospect.findUnique({ where: { id: input.prospectId } })
  if (!prospect) throw new Error('prospect not found')

  // Gather evidence: qualification signals, opportunity signals, any diagnostic
  const qualificationSignals = prospect.qualificationSignals ? JSON.parse(prospect.qualificationSignals) : []
  const opportunitySignals = prospect.opportunitySignals ? JSON.parse(prospect.opportunitySignals) : {}

  // Find the diagnostic run that produced this prospect's diagnosis (if any)
  const diagnosticRun = await t.diagnosticRun.findFirst({
    where: { prospectId: prospect.id },
    orderBy: { createdAt: 'desc' },
  })
  const diagnosis = diagnosticRun ? JSON.parse(diagnosticRun.diagnosis) : null

  const userMessage = `Prospect: ${prospect.company}
Website: ${prospect.website ?? 'not provided'}
Industry: ${prospect.industry ?? 'not provided'}
Size: ${prospect.size ?? 'not provided'}
Contact: ${prospect.contactName ?? 'unknown'} (${prospect.contactTitle ?? 'unknown title'})

QUALIFICATION SIGNALS (why we selected them):
${JSON.stringify(qualificationSignals, null, 2)}

OPPORTUNITY SIGNALS:
${JSON.stringify(opportunitySignals, null, 2)}

${diagnosis ? `DIAGNOSTIC FINDINGS (from the Marketing Growth Diagnostic):
${JSON.stringify(diagnosis, null, 2).slice(0, 4000)}` : 'No diagnostic run available.'}

Generate the personalized outreach draft as a single JSON object. Every claim must reference the evidence above.`

  const result: LLMResult = await provider.complete({
    systemPrompt: OUTREACH_SYSTEM_PROMPT,
    userMessage,
    json: true,
    thinking: false,
  })

  const draft = (result.parsed ?? {}) as OutreachDraft
  if (!draft.body) {
    // If parsing failed, use the raw content as the body
    draft.body = result.content
  }

  // Persist the outreach as a draft (requires human approval before sending)
  const outreach = await t.outreach.create({
    data: {
      prospectId: prospect.id,
      growthExperimentId: prospect.growthExperimentId ?? null,
      type: 'email',
      subject: draft.subjectLine ?? `Quick thought for ${prospect.company}`,
      body: draft.body,
      diagnosis: JSON.stringify({
        whyThem: draft.whyThem,
        problemObserved: draft.problemObserved,
        whyItMatters: draft.whyItMatters,
        whatMardiCanDo: draft.whatMardiCanDo,
        specificOffer: draft.specificOffer,
        cta: draft.cta,
        evidenceUsed: draft.evidenceUsed,
        confidence: draft.confidence,
        uncertainty: draft.uncertainty,
      }),
      rationale: draft.whyThem,
      status: 'draft',
    },
  })

  // Update prospect state
  await t.prospect.update({
    where: { id: prospect.id },
    data: { outreachState: 'drafting', status: 'diagnosed' },
  })

  return {
    outreachId: outreach.id,
    draft,
    provider: result.provider,
    model: result.model,
    fellBack: result.fellBack ?? false,
  }
}
