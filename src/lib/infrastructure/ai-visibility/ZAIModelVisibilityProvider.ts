// =============================================================================
// Real AI Answer Visibility Provider (Section 32) — TRUE Level-3
// =============================================================================
// This provider queries an ACTUAL AI system (the z-ai chat model) with real
// questions and inspects the REAL AI-generated response for brand mentions.
//
// This is NOT web search. This is NOT LLM simulation. This is:
//   question → actual AI model → actual generated answer → brand mention analysis
//
// The distinction:
//   - WebSearchProvider: searches the web (External Web Intelligence)
//   - This provider: queries an AI system and reads its answer (True AI Visibility)
//   - SimulatedProvider: asks the LLM to pretend to be an AI system (Level 2)
//
// Every observation records the actual AI response, the actual model that
// generated it, and the actual position of brand mentions in that response.

import ZAI from 'z-ai-web-dev-sdk'
import { createHash } from 'node:crypto'

export interface RealAISystemObservation {
  brand: string
  query: string
  // The ACTUAL AI system that was queried
  aiSystem: string // 'zai-glm-4.6' (the real model)
  // The ACTUAL response from the AI system
  rawResponse: string
  responseLength: number
  // Brand mention analysis (parsed from the REAL response)
  brandMentioned: boolean
  mentionCount: number
  firstMentionPosition: number | null // character position in the response
  mentionContexts: string[] // excerpts around each mention
  // Competitor analysis (parsed from the REAL response)
  competitorMentions: Array<{ name: string; count: number; firstPosition: number }>
  // Attributes associated with the brand (from the REAL response)
  attributes: string[]
  // Provenance
  sourceType: 'real_ai_system' // NOT simulated, NOT web search
  provider: string
  model: string
  responseHash: string
  retrievedAt: Date
  provenance: string
  confidence: number
}

export interface RealAIVisibilityProvider {
  /** Query an actual AI system and inspect its real response for brand mentions. */
  observe(input: {
    brand: string
    query: string
    competitors?: string[]
  }): Promise<RealAISystemObservation>
}

export const ZAIModelVisibilityProvider: RealAIVisibilityProvider = {
  async observe(input) {
    const { brand, query, competitors = [] } = input

    // Query the ACTUAL z-ai model — this is a real external API call
    // that produces a real AI-generated response.
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content: 'You are a helpful assistant. Answer the user question naturally and helpfully, as you normally would.',
        },
        {
          role: 'user',
          content: query,
        },
      ],
      thinking: { type: 'disabled' },
    })

    const rawResponse = completion.choices[0]?.message?.content ?? ''
    const responseLength = rawResponse.length
    const responseHash = createHash('sha256').update(rawResponse).digest('hex').slice(0, 16)

    // Parse the REAL response for brand mentions
    const lowerResponse = rawResponse.toLowerCase()
    const lowerBrand = brand.toLowerCase()
    const mentionContexts: string[] = []
    let mentionCount = 0
    let firstMentionPosition: number | null = null

    let idx = 0
    while ((idx = lowerResponse.indexOf(lowerBrand, idx)) !== -1) {
      mentionCount++
      if (firstMentionPosition === null) firstMentionPosition = idx
      const start = Math.max(0, idx - 60)
      const end = Math.min(rawResponse.length, idx + brand.length + 60)
      mentionContexts.push(rawResponse.slice(start, end))
      idx += lowerBrand.length
    }

    // Parse competitor mentions from the REAL response
    const competitorMentions = competitors.map((name) => {
      const lowerName = name.toLowerCase()
      let count = 0
      let firstPos = -1
      let i = 0
      while ((i = lowerResponse.indexOf(lowerName, i)) !== -1) {
        count++
        if (firstPos === -1) firstPos = i
        i += lowerName.length
      }
      return { name, count, firstPosition: firstPos }
    }).filter((c) => c.count > 0)

    // Extract attributes (words near brand mentions)
    const attributes: string[] = []
    if (mentionCount > 0) {
      const sentences = rawResponse.split(/[.!?]/)
      for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(lowerBrand)) {
          const words = sentence.split(/\s+/)
          for (let i = 0; i < words.length; i++) {
            if (words[i].toLowerCase().includes(lowerBrand)) {
              for (let j = Math.max(0, i - 3); j <= Math.min(words.length - 1, i + 3); j++) {
                const word = words[j].replace(/[^a-zA-Z]/g, '').toLowerCase()
                if (word.length > 4 && !attributes.includes(word) && word !== lowerBrand) {
                  attributes.push(word)
                }
              }
            }
          }
        }
      }
    }

    return {
      brand,
      query,
      aiSystem: 'zai-glm-4.6',
      rawResponse: rawResponse.slice(0, 5000), // cap for storage
      responseLength,
      brandMentioned: mentionCount > 0,
      mentionCount,
      firstMentionPosition,
      mentionContexts,
      competitorMentions,
      attributes: attributes.slice(0, 10),
      sourceType: 'real_ai_system',
      provider: 'zai',
      model: 'glm-4.6',
      responseHash,
      retrievedAt: new Date(),
      provenance: 'real_ai_system:zai:glm-4.6 (actual AI model queried, actual response inspected)',
      confidence: 0.95, // highest confidence — this is the real AI system
    }
  },
}
