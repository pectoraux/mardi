// =============================================================================
// ZAIProvider — adapts z-ai-web-dev-sdk to the LLMProvider port (ADR-0004).
// =============================================================================
// Reads config from env vars (Vercel) or .z-ai-config file (sandbox).
// Falls back to LocalModelProvider if the API is unreachable.

import type { LLMProvider, LLMRequest, LLMResult } from '../../../application/ports'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const MODEL = 'glm-4.6'
const MODEL_VERSION = 'glm-4.6-v1'
const PROVIDER_NAME = 'zai'

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
    } catch { /* continue */ }
  }
  _cachedConfig = null
  return null
}

function stripFences(s: string): string {
  let out = s.trim()
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  }
  return out
}

export const ZAIProvider: LLMProvider = {
  name: PROVIDER_NAME,
  model: MODEL,
  modelVersion: MODEL_VERSION,

  async complete(req: LLMRequest): Promise<LLMResult> {
    const config = await loadConfig()
    const started = Date.now()

    const messages: { role: 'assistant' | 'user'; content: string }[] = [
      { role: 'assistant', content: req.systemPrompt },
      ...(req.history ?? []),
      { role: 'user', content: req.userMessage },
    ]
    if (req.json) {
      messages.push({
        role: 'assistant',
        content: 'Respond with a single valid JSON object only. No prose, no markdown fences, no commentary.',
      })
    }

    if (!config) {
      // Defer to LocalModelProvider fallback
      const { LocalModelProvider } = await import('./LocalModelProvider')
      return LocalModelProvider.complete(req)
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
          thinking: { type: req.thinking ? 'enabled' : 'disabled' },
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        console.error(`[ZAIProvider] API error ${response.status}: ${errorBody.slice(0, 200)}`)
        const { LocalModelProvider } = await import('./LocalModelProvider')
        return LocalModelProvider.complete(req)
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const content = data.choices?.[0]?.message?.content ?? ''
      const latencyMs = Date.now() - started

      let parsed: unknown
      if (req.json) {
        try { parsed = JSON.parse(stripFences(content)) } catch { parsed = undefined }
      }

      return {
        content,
        parsed,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        latencyMs,
        provider: PROVIDER_NAME,
        model: MODEL,
        modelVersion: MODEL_VERSION,
      }
    } catch (err) {
      console.error('[ZAIProvider] request failed, using fallback:', err)
      const { LocalModelProvider } = await import('./LocalModelProvider')
      return LocalModelProvider.complete(req)
    }
  },
}
