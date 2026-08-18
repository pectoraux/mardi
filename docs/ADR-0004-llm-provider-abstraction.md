# ADR-0004: LLM Provider Abstraction

- **Status**: Accepted
- **Date**: 2024 (hardening pass, post-MVP)
- **Decision owner**: orchestrator (architectural hardening)
- **Related**: master prompt Section 18 (Agent Platform), Section 19 (Agent Tool Contracts), Section 26 (Cost Attribution), Section 35 (OBSERVED / INFERRED / PREDICTED / RECOMMENDED); `AI_ARCHITECTURE.md`, `ADR-0001-environment-adaptation.md`, `ADR-0003-repository-port-adapter.md`, `OPERATIONS.md`

## Context

The MVP Strategy Agent (`src/lib/agents/strategy-agent.ts`) depends on `src/lib/ai/llm.ts`, which wraps the **z-ai-web-dev-sdk**. The wrapper was the right call for the MVP slice: it isolated SDK calls behind one module, made the SDK injectable for the agent, and let Task `10-auth-deploy` swap the SDK configuration from a hardcoded value to env vars (`ZAI_BASE_URL`, `ZAI_API_KEY`, `ZAI_TOKEN`, `ZAI_USER_ID`, `ZAI_CHAT_ID`) without touching the agent.

The hardening review flagged a remaining risk: the agent still **imports the SDK's response shape** (message structure, token usage fields, error semantics). Section 18 calls the agent platform "model-agnostic in principle"; Section 26 requires **per-model cost attribution** (tokens/compute/storage per tenant / workflow / agent / model). Both requirements are undermined if the agent knows what a `z-ai-web-dev-sdk` response looks like.

The architect's framing:

> *"Today the model economics are fixed by a single SDK. The moment a tenant asks for GPT-4-class reasoning, or a cheaper model for trivial classification, or an on-prem fine-tune for a regulated workload, the agent system has to be rewritten. Build the seam now, while only one provider exists, not when a second one is already in production."*

## Decision

Introduce an **`LLMProvider` port interface** in `src/lib/domain/ports/LLMProvider.ts`. The Strategy Agent (and every future agent) depends on this port, not on `z-ai-web-dev-sdk` and not on `src/lib/ai/llm.ts` directly. The provider is supplied to the agent via **dependency injection** at agent construction time.

### Port interface

```ts
// src/lib/domain/ports/LLMProvider.ts
export interface LLMProvider {
  /** Stable identifier used for cost attribution (Section 26). */
  readonly providerId: string;   // e.g. "zai", "openai", "anthropic", "gemini", "local"
  readonly modelId: string;      // e.g. "glm-4.6", "gpt-4o", "claude-3.5-sonnet", "gemini-1.5-pro", "local-rule-based"

  /**
   * Run a chat completion with tool definitions.
   * Returns a typed ChatResult: the assistant message(s), any tool_call
   * requests the model emitted, and token usage for cost attribution.
   */
  complete(req: ChatRequest): Promise<ChatResult>;
}

export interface ChatRequest {
  systemPrompt: string;
  messages: ChatMessage[];          // role: 'user' | 'assistant' | 'tool'
  tools?: ToolDefinition[];         // mirrors the typed ToolDef registry (Section 19)
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json'; // Section 35 structured-output requirement
  tenantId: string;                 // every call is tenant-scoped for attribution + logging
  agentId: string;                  // every call is agent-scoped for attribution
  workflowId?: string;              // optional: ties to Workflow for cost rollup
}

export interface ChatResult {
  message: ChatMessage;
  toolCalls: ToolCall[];            // normalized — never provider-native shape
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  rawProviderResponseId: string;    // for traceability; the only provider-specific field exposed
}
```

### Adapters

| Adapter                | File                                              | Status      | Wraps                                                                  | Use case                                                                 |
| ---------------------- | ------------------------------------------------- | ----------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **ZAIProvider**        | `src/lib/infrastructure/llm/ZAIProvider.ts`       | Active      | `z-ai-web-dev-sdk` (the current MVP SDK)                               | Default for local/dev and for Vercel deployment (Task `10-auth-deploy`)  |
| **OpenAIProvider**     | `src/lib/infrastructure/llm/OpenAIProvider.ts`    | Stub        | `openai` npm package                                                   | GPT-4-class reasoning when a tenant requests it                          |
| **AnthropicProvider**  | `src/lib/infrastructure/llm/AnthropicProvider.ts` | Stub        | `@anthropic-ai/sdk`                                                    | Claude for long-context analysis (creative analysis, evidence synthesis) |
| **GeminiProvider**     | `src/lib/infrastructure/llm/GeminiProvider.ts`    | Stub        | `@google/generative-ai`                                                | Multimodal creative analysis (image + text inputs)                       |
| **LocalModelProvider** | `src/lib/infrastructure/llm/LocalModelProvider.ts`| Structured fallback | Rule-based / template responses; no external calls, deterministic | Cost-zero fallback when no LLM is configured, or for unit tests of the agent loop |

A **`LLMProviderRegistry`** selects the provider per call. Selection inputs:

- **Tenant default** (`Tenant.llmProvider` + `Tenant.llmModel`) — the tenant's standard model.
- **Agent override** — e.g. the Strategy Agent may use a stronger model than a triage agent.
- **Task routing** — simple classification tasks (intent detection, PII redaction) route to the cheapest provider; synthesis tasks route to the strongest. (Future: a `ModelRouter` policy; out of scope for this ADR.)

The agent constructor takes `LLMProvider` (or a factory `(req: ChatRequest) => LLMProvider` for task-routed selection). The agent never references `z-ai-web-dev-sdk`, `openai`, `@anthropic-ai/sdk`, or any SDK type.

### Cost attribution (Section 26)

Every `ChatResult.usage` is written to the existing `AgentToolCall` row (and a future `LLMCall` row if granular) along with `providerId`, `modelId`, `tenantId`, `agentId`, `workflowId`. This is what makes Section 26's *"cost attribution per tenant / workflow / agent / model"* actually achievable — today only one `providerId` exists, but the schema already supports many.

## Consequences

**Positive**

- **Model economics can change without an agent rewrite.** A tenant that wants Claude for synthesis and GPT-4 for budgeting gets it by changing two config values; the Strategy Agent code is unchanged.
- **Cost attribution is per-model by construction.** `providerId` + `modelId` + `usage` flow through the port, so the Section 26 cost ledger is correct from day one.
- **Testability.** `LocalModelProvider` lets the agent loop be unit-tested without an LLM key — the agent's tool-call / structured-output discipline can be verified deterministically.
- **Vendor lock-in is structurally prevented.** The same lint rule proposed in ADR-0003 (`no-restricted-imports`) is extended to forbid `z-ai-web-dev-sdk`, `openai`, `@anthropic-ai/sdk`, and `@google/generative-ai` in `src/lib/domain/**` and `src/lib/agents/**`.
- **SDK changes are isolated.** If `z-ai-web-dev-sdk` releases a breaking change, only `ZAIProvider.ts` is touched; the agent and the other adapters are unaffected.

**Negative**

- One more abstraction layer; the adapter list will grow as new providers are added.
- The port shape is a **least-common-denominator** of provider capabilities. Provider-specific features (Anthropic's prompt caching, Gemini's multimodal grounding, OpenAI's function-calling parity) must either be modeled in the port (bloats the interface) or exposed via provider-specific escape hatches (re-introduces coupling). Decision: keep the port minimal; provider-specific features are exposed via `ChatRequest.metadata` (a typed extension object) and **only** the Strategy Agent (or other explicitly-aware consumers) may read them.
- Stubs (OpenAI, Anthropic, Gemini) are placeholders today; production use requires implementing them with the SDK's auth, retry, and rate-limit semantics.

## Alternatives considered

1. **Keep `src/lib/ai/llm.ts` as the only seam, swap SDKs inside it** — rejected: the wrapper still exposes SDK response shapes to the agent, and a second SDK would force the wrapper to fork by provider. The port/adapter split keeps each SDK in its own adapter file.
2. **Use LangChain / Vercel AI SDK as the abstraction** — rejected for the MVP: both are heavy dependencies, both impose their own message/tool shape (still provider-shaped, just shifted one layer up), and both complicate the Section 26 cost model (their token accounting is not always pass-through). A hand-rolled port is ~80 lines and gives full control.
3. **Single-provider hardcode + ADR deferral** — rejected: the hardening review explicitly called out that the seam must exist before a second provider is needed, not after.
4. **Generate the port from an OpenAPI spec of each provider** — rejected: providers do not share an OpenAPI spec; codegen would not reduce coupling.

## Migration plan

1. Create `src/lib/domain/ports/LLMProvider.ts` with the interface above.
2. Implement `ZAIProvider` by moving the existing logic from `src/lib/ai/llm.ts` into the adapter; `llm.ts` becomes a thin compatibility re-export (deprecated) so existing callers keep working during the refactor.
3. Implement `LocalModelProvider` as the deterministic fallback (returns canned responses keyed off the request's tool list — enough to drive the agent loop in tests).
4. Add stubs for `OpenAIProvider`, `AnthropicProvider`, `GeminiProvider` that throw `ProviderNotConfiguredError` when invoked without credentials.
5. Update `StrategyAgent` to take `LLMProvider` in its constructor.
6. Add the `no-restricted-imports` lint rule for SDK packages in `src/lib/domain/**` and `src/lib/agents/**`.
7. Wire `LLMProviderRegistry` to read `Tenant.llmProvider` / `Tenant.llmModel` (new columns) with env-var fallback for non-tenant-scoped calls.
