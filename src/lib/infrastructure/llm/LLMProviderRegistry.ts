// =============================================================================
// LLM provider registry — selects the active provider by config (ADR-0004).
// =============================================================================
// LLM_PROVIDER env var selects: zai (default) | openai | anthropic | gemini | local
// The selected provider is cached for the process lifetime.

import type { LLMProvider } from '../../application/ports'
import { ZAIProvider } from './ZAIProvider'
import { LocalModelProvider } from './LocalModelProvider'
import { OpenAIProvider, AnthropicProvider, GeminiProvider } from './StubProviders'

const PROVIDERS: Record<string, LLMProvider> = {
  zai: ZAIProvider,
  openai: OpenAIProvider,
  anthropic: AnthropicProvider,
  gemini: GeminiProvider,
  local: LocalModelProvider,
}

let _active: LLMProvider | null = null

export function getLLMProvider(): LLMProvider {
  if (_active) return _active
  const name = (process.env.LLM_PROVIDER ?? 'zai').toLowerCase()
  _active = PROVIDERS[name] ?? ZAIProvider
  return _active
}

export function setLLMProvider(provider: LLMProvider): void {
  _active = provider
}

export function listProviders(): Array<{ name: string; model: string; modelVersion: string }> {
  return Object.values(PROVIDERS).map((p) => ({
    name: p.name,
    model: p.model,
    modelVersion: p.modelVersion,
  }))
}

export { ZAIProvider, LocalModelProvider, OpenAIProvider, AnthropicProvider, GeminiProvider }
