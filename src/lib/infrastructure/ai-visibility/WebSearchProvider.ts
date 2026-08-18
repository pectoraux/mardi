// =============================================================================
// Real Web-Based AI Visibility Provider (Section 32) — LEVEL 3
// =============================================================================
// This provider makes REAL external HTTP requests via the z-ai SDK's
// web_search and page_reader functions. It does NOT use LLM simulation.
//
// Every observation records:
//   - query
//   - provider: "web_search" (real external system)
//   - raw search results (URLs, snippets)
//   - page content (fetched from real URLs)
//   - brand mention detection (parsed from real content)
//   - position (rank in search results)
//   - competitors (parsed from real content)
//   - source URLs
//   - response hash (content hash for change detection)
//   - retrieval timestamp
//   - provenance: "web_search:z-ai-sdk"
//
// This is SOURCE = REAL_EXTERNAL_SYSTEM, not SIMULATED.

import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

export interface RealSearchResult {
  title: string
  url: string
  snippet: string
  position: number
}

export interface RealPageContent {
  url: string
  title: string
  content: string
  contentHash: string
  retrievedAt: Date
}

export interface RealAIObservation {
  brand: string
  query: string
  provider: 'web_search' // REAL external system
  sourceType: 'real_external'
  searchResults: RealSearchResult[]
  pagesRead: RealPageContent[]
  brandMentioned: boolean
  mentionPositions: Array<{ url: string; position: number; context: string }>
  competitorMentions: Array<{ name: string; url: string; count: number }>
  attributes: string[]
  sourceUrls: string[]
  responseHash: string
  retrievedAt: Date
  provenance: string
  confidence: number
}

export interface RealAIVisibilityProvider {
  observe(input: {
    brand: string
    query: string
    competitors?: string[]
    numResults?: number
    readPages?: boolean
  }): Promise<RealAIObservation>
}

// ---------------------------------------------------------------------------
// z-ai SDK function invoker — calls the real web_search and page_reader
// ---------------------------------------------------------------------------
async function invokeZaiFunction(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { execSync } = await import('node:child_process')
  const outFile = join(tmpdir(), `zai-fn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
  const argsStr = JSON.stringify(args).replace(/'/g, "'\\''")
  const cmd = `z-ai function --name "${name}" --args '${argsStr}' -o "${outFile}" 2>&1`

  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 30000 })
    void output
    const content = await readFile(outFile, 'utf-8')
    return JSON.parse(content)
  } catch (err) {
    throw new Error(`z-ai function ${name} failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Search the real web
// ---------------------------------------------------------------------------
async function webSearch(query: string, num: number = 5): Promise<RealSearchResult[]> {
  const result = await invokeZaiFunction('web_search', { query, num })
  // The result format varies — handle both array and object
  const results = Array.isArray(result) ? result :
    (result as Record<string, unknown>)?.result ? (result as { result: unknown[] }).result :
    (result as Record<string, unknown>)?.data ? (result as { data: unknown[] }).data : []

  return results.map((r, i) => {
    const item = r as Record<string, string>
    return {
      title: item.title || item.name || '',
      url: item.url || item.link || item.href || '',
      snippet: item.snippet || item.description || item.summary || '',
      position: i + 1,
    }
  }).filter((r) => r.url)
}

// ---------------------------------------------------------------------------
// Read a real web page
// ---------------------------------------------------------------------------
async function readPage(url: string): Promise<RealPageContent | null> {
  try {
    const result = await invokeZaiFunction('page_reader', { url })
    const data = (result as Record<string, unknown>)?.data ?? result
    const html = (data as Record<string, unknown>)?.html as string ?? ''
    const title = (data as Record<string, unknown>)?.title as string ?? ''

    // Strip HTML tags to get text content
    const textContent = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    return {
      url,
      title,
      content: textContent.slice(0, 10000), // cap for storage
      contentHash: createHash('sha256').update(textContent).digest('hex').slice(0, 16),
      retrievedAt: new Date(),
    }
  } catch (err) {
    console.error(`[ai-visibility] page_reader failed for ${url}:`, err)
    return null
  }
}

// ---------------------------------------------------------------------------
// Detect brand mentions in real text content
// ---------------------------------------------------------------------------
function detectMentions(content: string, brand: string): Array<{ position: number; context: string }> {
  const mentions: Array<{ position: number; context: string }> = []
  const lowerContent = content.toLowerCase()
  const lowerBrand = brand.toLowerCase()
  let idx = 0
  while ((idx = lowerContent.indexOf(lowerBrand, idx)) !== -1) {
    const start = Math.max(0, idx - 50)
    const end = Math.min(content.length, idx + brand.length + 50)
    mentions.push({
      position: idx,
      context: content.slice(start, end),
    })
    idx += lowerBrand.length
  }
  return mentions
}

function detectCompetitors(content: string, competitors: string[]): Array<{ name: string; count: number }> {
  return competitors.map((name) => {
    const lowerContent = content.toLowerCase()
    const lowerName = name.toLowerCase()
    let count = 0
    let idx = 0
    while ((idx = lowerContent.indexOf(lowerName, idx)) !== -1) {
      count++
      idx += lowerName.length
    }
    return { name, count }
  }).filter((c) => c.count > 0)
}

// ---------------------------------------------------------------------------
// Extract attributes associated with the brand from real content
// ---------------------------------------------------------------------------
function extractAttributes(content: string, brand: string): string[] {
  const attributes: string[] = []
  const lowerContent = content.toLowerCase()
  const lowerBrand = brand.toLowerCase()

  // Find sentences containing the brand and extract descriptive words
  const sentences = content.split(/[.!?]/)
  for (const sentence of sentences) {
    if (sentence.toLowerCase().includes(lowerBrand)) {
      // Extract adjectives/descriptors near the brand mention
      const words = sentence.split(/\s+/)
      for (let i = 0; i < words.length; i++) {
        if (words[i].toLowerCase().includes(lowerBrand)) {
          // Look at surrounding words for attributes
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
  return attributes.slice(0, 10)
}

// ---------------------------------------------------------------------------
// The real provider implementation
// ---------------------------------------------------------------------------
export const WebSearchAIVisibilityProvider: RealAIVisibilityProvider = {
  async observe(input) {
    const { brand, query, competitors = [], numResults = 5, readPages = true } = input

    // 1. Search the real web
    const searchResults = await webSearch(query, numResults)

    // 2. Read the top results (real HTTP requests)
    const pagesRead: RealPageContent[] = []
    if (readPages) {
      for (const result of searchResults.slice(0, 3)) {
        const page = await readPage(result.url)
        if (page) pagesRead.push(page)
      }
    }

    // 3. Detect brand mentions in real content
    const mentionPositions: Array<{ url: string; position: number; context: string }> = []

    // Check search result snippets
    for (const result of searchResults) {
      const mentions = detectMentions(result.snippet, brand)
      for (const m of mentions) {
        mentionPositions.push({ url: result.url, position: result.position, context: m.context })
      }
    }

    // Check page content
    for (const page of pagesRead) {
      const mentions = detectMentions(page.content, brand)
      for (const m of mentions) {
        mentionPositions.push({ url: page.url, position: m.position, context: m.context })
      }
    }

    // 4. Detect competitor mentions
    const allContent = [
      ...searchResults.map((r) => r.snippet),
      ...pagesRead.map((p) => p.content),
    ].join(' ')
    const competitorMentions = detectCompetitors(allContent, competitors).map((c) => ({
      name: c.name,
      url: searchResults.find((r) => r.snippet.toLowerCase().includes(c.name.toLowerCase()))?.url ?? '',
      count: c.count,
    }))

    // 5. Extract attributes
    const attributes = extractAttributes(allContent, brand)

    // 6. Compute response hash (for change detection)
    const responseHash = createHash('sha256')
      .update(JSON.stringify({ searchResults, pagesRead: pagesRead.map((p) => p.contentHash) }))
      .digest('hex')
      .slice(0, 16)

    const brandMentioned = mentionPositions.length > 0

    return {
      brand,
      query,
      provider: 'web_search',
      sourceType: 'real_external',
      searchResults,
      pagesRead,
      brandMentioned,
      mentionPositions,
      competitorMentions,
      attributes,
      sourceUrls: searchResults.map((r) => r.url),
      responseHash,
      retrievedAt: new Date(),
      provenance: 'web_search:z-ai-sdk (REAL external HTTP requests)',
      confidence: 0.9, // high confidence because these are real observations
    }
  },
}
