// =============================================================================
// LLM wrapper — z-ai API with env-var config + graceful fallback (Section 18)
// =============================================================================
// The z-ai-web-dev-sdk reads from a .z-ai-config file (sandbox-only). On
// Vercel (or any environment without that file), we read config from env
// vars and make direct HTTP calls to the same API. If the API is unreachable,
// we fall back to a structured response generated from the grounding data —
// the app stays functional, the agent just doesn't have LLM reasoning.
//
// Env vars (set on Vercel):
//   ZAI_BASE_URL  — e.g. https://internal-api.z.ai/v1
//   ZAI_API_KEY   — e.g. Z.ai
//   ZAI_TOKEN     — session JWT
//   ZAI_USER_ID   — user id
//   ZAI_CHAT_ID   — chat id

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export interface LlmResult {
  content: string
  parsed?: unknown
  inputTokens: number
  outputTokens: number
  latencyMs: number
  model: string
  fellBack?: boolean
}

export interface ChatOptions {
  systemPrompt: string
  userMessage: string
  json?: boolean
  history?: { role: 'user' | 'assistant'; content: string }[]
  thinking?: boolean
}

const MODEL = 'glm-4.6'
const MODEL_PROVIDER = 'z-ai'

interface ZaiConfig {
  baseUrl: string
  apiKey: string
  token?: string
  userId?: string
  chatId?: string
}

let _cachedConfig: ZaiConfig | null | undefined

async function loadConfig(): Promise<ZaiConfig | null> {
  if (_cachedConfig !== undefined) return _cachedConfig

  // 1. Try env vars first (Vercel)
  if (process.env.ZAI_BASE_URL && process.env.ZAI_API_KEY) {
    _cachedConfig = {
      baseUrl: process.env.ZAI_BASE_URL,
      apiKey: process.env.ZAI_API_KEY,
      token: process.env.ZAI_TOKEN,
      userId: process.env.ZAI_USER_ID,
      chatId: process.env.ZAI_CHAT_ID,
    }
    return _cachedConfig
  }

  // 2. Try .z-ai-config files (sandbox)
  const configPaths = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ]
  for (const filePath of configPaths) {
    try {
      const configStr = await readFile(filePath, 'utf-8')
      const config = JSON.parse(configStr)
      if (config.baseUrl && config.apiKey) {
        _cachedConfig = config
        return _cachedConfig
      }
    } catch {
      // continue
    }
  }

  _cachedConfig = null
  return null
}

export async function chat(opts: ChatOptions): Promise<LlmResult> {
  const config = await loadConfig()
  const started = Date.now()

  const messages: { role: 'assistant' | 'user'; content: string }[] = [
    { role: 'assistant', content: opts.systemPrompt },
    ...(opts.history ?? []),
    { role: 'user', content: opts.userMessage },
  ]
  if (opts.json) {
    messages.push({
      role: 'assistant',
      content:
        'Respond with a single valid JSON object only. No prose, no markdown fences, no commentary.',
    })
  }

  // If no config available, fall back immediately
  if (!config) {
    console.warn('[llm] no z-ai config available — using fallback')
    return fallback(opts, started)
  }

  try {
    const url = `${config.baseUrl}/chat/completions`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'X-Z-AI-From': 'Z',
    }
    if (config.chatId) headers['X-Chat-Id'] = config.chatId
    if (config.userId) headers['X-User-Id'] = config.userId
    if (config.token) headers['X-Token'] = config.token

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages,
        thinking: { type: opts.thinking ? 'enabled' : 'disabled' },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error(`[llm] API error ${response.status}: ${errorBody.slice(0, 200)}`)
      return fallback(opts, started)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = data.choices?.[0]?.message?.content ?? ''
    const latencyMs = Date.now() - started

    let parsed: unknown
    if (opts.json) {
      try {
        parsed = JSON.parse(stripFences(content))
      } catch {
        parsed = undefined
      }
    }

    return {
      content,
      parsed,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs,
      model: MODEL,
    }
  } catch (err) {
    console.error('[llm] request failed, using fallback:', err)
    return fallback(opts, started)
  }
}

function stripFences(s: string): string {
  let out = s.trim()
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  }
  return out
}

// ---------------------------------------------------------------------------
// Fallback — generates a structured response from the user message + system
// prompt. This is NOT LLM reasoning, but it keeps the agent functional when
// the z-ai API is unreachable (e.g. on Vercel without config).
// ---------------------------------------------------------------------------
function fallback(opts: ChatOptions, started: number): LlmResult {
  // Try to extract grounding data from the user message (the strategy agent
  // embeds pre-gathered tool results in the prompt).
  const groundingMatch = opts.userMessage.match(
    /Pre-gathered tool results[\s\S]*?(\{[\s\S]*\})\s*Available tools/
  )
  let grounding: Record<string, unknown> = {}
  if (groundingMatch) {
    try {
      // Extract the JSON block — it may be truncated
      const raw = groundingMatch[1]
      grounding = JSON.parse(raw)
    } catch {
      // ignore parse failure
    }
  }

  const marketState = grounding.get_market_state as
    | { channels?: Array<{ channel: string; spend: number; campaigns: number }>; totalSpend?: number; brands?: unknown[] }
    | undefined
  const customerState = grounding.get_customer_state as
    | { segments?: Array<{ segment: string; count: number; avgLtv: number }>; totalCustomers?: number; totalLtv?: number }
    | undefined
  const experiments = grounding.query_experiments as
    | Array<{ name?: string; hypothesis?: string; decision?: string; learning?: string; methodology?: string }>
    | undefined
  const causal = grounding.estimate_incrementality as
    | Array<{ campaignId?: string; estimates?: Array<{ methodology: string; metric: string; effectSizePct: number; uncertainty: number[]; confidence: number }> }>
    | undefined

  const observed: string[] = []
  if (marketState) {
    observed.push(`Total marketing spend is $${marketState.totalSpend ?? 0} across ${marketState.channels?.length ?? 0} channels.`)
    marketState.channels?.forEach((c) => {
      observed.push(`${c.channel}: $${c.spend} spend, ${c.campaigns} campaign(s).`)
    })
  }
  if (customerState) {
    observed.push(`${customerState.totalCustomers} customers with total LTV $${customerState.totalLtv}.`)
    customerState.segments?.forEach((s) => {
      observed.push(`${s.segment} segment: ${s.count} customers, avg LTV $${s.avgLtv}.`)
    })
  }
  if (experiments) {
    experiments.forEach((e) => {
      observed.push(`Experiment "${e.name}" (${e.methodology}): decision=${e.decision ?? 'pending'}.`)
      if (e.learning) observed.push(`Learning: ${e.learning}`)
    })
  }

  const inferred: string[] = []
  if (causal && causal.length > 0) {
    causal.forEach((c) => {
      c.estimates?.forEach((e) => {
        inferred.push(`${e.methodology} on ${e.metric}: effect ${(e.effectSizePct * 100).toFixed(1)}% (CI [${(e.uncertainty[0] * 100).toFixed(1)}%, ${(e.uncertainty[1] * 100).toFixed(1)}%], confidence ${(e.confidence * 100).toFixed(0)}%).`)
      })
    })
  }

  const recommended: string[] = []
  if (causal && causal.length > 0) {
    const best = causal
      .flatMap((c) => c.estimates ?? [])
      .sort((a, b) => b.confidence - a.confidence)[0]
    if (best && best.effectSizePct > 0.1) {
      recommended.push(`Scale the campaign with ${best.methodology} lift of +${(best.effectSizePct * 100).toFixed(1)}% — the strongest causal evidence available.`)
    }
  }
  recommended.push('Run a holdout experiment on any budget increase to confirm sustained incrementality.')

  const evidence: Array<{ type: string; id: string; summary: string }> = []
  if (experiments) {
    experiments.slice(0, 2).forEach((e, i) => {
      evidence.push({ type: 'Experiment', id: `exp-${i}`, summary: e.learning ?? e.hypothesis ?? 'Experiment completed' })
    })
  }
  if (causal) {
    causal.flatMap((c) => c.estimates ?? []).slice(0, 2).forEach((e, i) => {
      evidence.push({ type: 'CausalEstimate', id: `ce-${i}`, summary: `${e.methodology} on ${e.metric}: +${(e.effectSizePct * 100).toFixed(1)}%` })
    })
  }

  const structured = {
    summary: 'Based on the available causal evidence and market state, here is what the data supports.',
    observed: observed.length > 0 ? observed : ['No data available.'],
    inferred,
    predicted: ['Scaling budget proportionally to causal lift should increase incremental revenue, subject to diminishing returns.'],
    recommended,
    evidence,
    uncertainty: 'Confidence depends on the causal methodology and sample size. See evidence citations for specifics.',
    nextBestExperiment: 'Run a geo holdout on the next budget increment to confirm sustained incrementality before full scaling.',
  }

  const content = JSON.stringify(structured, null, 2)
  return {
    content,
    parsed: structured,
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: Date.now() - started,
    model: `${MODEL} (fallback)`,
    fellBack: true,
  }
}

export const LLM_META = { model: MODEL, provider: MODEL_PROVIDER, promptVersion: 'v1' }
