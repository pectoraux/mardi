// =============================================================================
// LLM provider stubs — OpenAI, Anthropic, Gemini.
// =============================================================================
// These implement the LLMProvider port but throw "not implemented" until
// the corresponding SDK + credentials are wired. They exist so the adapter
// list is complete and the composition root can select any provider by
// config without code changes (ADR-0004).

import type { LLMProvider, LLMRequest, LLMResult } from '../../../application/ports'

function notImplemented(provider: string): Promise<LLMResult> {
  return Promise.reject(new Error(
    `${provider} provider not implemented yet. Set LLM_PROVIDER=zai or LLM_PROVIDER=local. ` +
    `To enable ${provider}, add the corresponding SDK and credentials, then implement the adapter.`
  ))
}

export const OpenAIProvider: LLMProvider = {
  name: 'openai',
  model: 'gpt-4o',
  modelVersion: 'gpt-4o-2024-08-06',
  async complete(_req: LLMRequest): Promise<LLMResult> {
    return notImplemented('openai')
  },
}

export const AnthropicProvider: LLMProvider = {
  name: 'anthropic',
  model: 'claude-3-5-sonnet',
  modelVersion: 'claude-3-5-sonnet-20241022',
  async complete(_req: LLMRequest): Promise<LLMResult> {
    return notImplemented('anthropic')
  },
}

export const GeminiProvider: LLMProvider = {
  name: 'gemini',
  model: 'gemini-1.5-pro',
  modelVersion: 'gemini-1.5-pro-002',
  async complete(_req: LLMRequest): Promise<LLMResult> {
    return notImplemented('gemini')
  },
}
