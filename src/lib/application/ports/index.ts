// =============================================================================
// Application PORT interfaces — infrastructure seams the agents depend on.
// =============================================================================
// These ports define what the application layer NEEDS from infrastructure.
// Concrete adapters (in src/lib/infrastructure/) implement these. The
// composition root wires the chosen adapters into the application.

// ---------------------------------------------------------------------------
// LLMProvider — the AI model abstraction (ADR-0004)
// ---------------------------------------------------------------------------
// The Strategy Agent depends on this interface, NOT on z-ai-web-dev-sdk.
// Adapters: ZAIProvider, OpenAIProvider, AnthropicProvider, GeminiProvider,
// LocalModelProvider. Swapping providers (for cost, latency, or capability)
// requires only changing the adapter wired in the composition root.

export interface LLMProvider {
  readonly name: string // 'zai' | 'openai' | 'anthropic' | 'gemini' | 'local'
  readonly model: string
  readonly modelVersion: string

  complete(req: LLMRequest): Promise<LLMResult>
}

export interface LLMRequest {
  systemPrompt: string
  userMessage: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  json?: boolean
  thinking?: boolean
}

export interface LLMResult {
  content: string
  parsed?: unknown
  inputTokens: number
  outputTokens: number
  latencyMs: number
  provider: string
  model: string
  modelVersion: string
  fellBack?: boolean
}

// ---------------------------------------------------------------------------
// EventBus — the event backbone abstraction (Section 8)
// ---------------------------------------------------------------------------
export interface EventBusPort {
  emit(ctx: import('../../tenant-context').TenantContext, event: {
    eventType: string
    source: string
    entityType?: string
    entityId?: string
    occurredAt?: Date
    properties: Record<string, unknown>
    lineageId?: string
  }): Promise<import('../../domain/entities').CanonicalEvent>

  subscribe(eventType: string, fn: (e: import('../../domain/entities').CanonicalEvent) => void | Promise<void>): () => void
}

// ---------------------------------------------------------------------------
// ExecutionMode — the execution boundary abstraction (ADR-0005)
// ---------------------------------------------------------------------------
export type ExecutionMode = 'SIMULATION' | 'SANDBOX' | 'LIVE'

export interface ModeAwareExecutor {
  /** Returns the effective mode for a tenant (default SIMULATION). */
  getMode(tenantId: string): Promise<ExecutionMode>

  /**
   * Execute an action in the tenant's current mode.
   * SIMULATION: records the action but does not perform it.
   * SANDBOX: performs the action against a sandbox/test environment.
   * LIVE: performs the real action (requires approval + autonomy ≥ 4).
   */
  execute<T = unknown>(
    ctx: import('../../tenant-context').TenantContext,
    action: {
      type: string
      description: string
      perform: () => Promise<T>
      performSandbox?: () => Promise<T>
    }
  ): Promise<{ result: T | null; mode: ExecutionMode; simulated: boolean }>
}
