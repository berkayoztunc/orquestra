/**
 * AI-powered program categorization using Cloudflare Workers AI.
 * Classifies Solana programs into a fixed taxonomy so they are
 * easier to find via full-text search.
 */

// Fixed taxonomy — must stay in sync with KNOWN_PROGRAMS categories
// in program-auto-detect.ts and with CATEGORY_LABELS in the frontend.
export const CATEGORY_TAXONOMY = [
  'dex-amm',
  'lending',
  'staking',
  'nft-marketplace',
  'token-launch',
  'gaming',
  'payments',
  'governance',
  'perpetuals',
  'derivatives',
  'infrastructure',
  'social',
  'other',
] as const

export type ProgramCategory = (typeof CATEGORY_TAXONOMY)[number]

export interface CategorizationInput {
  name: string
  description?: string | null
  programId: string
  instructions: string[]
  accounts: string[]
}

export interface CategorizationResult {
  category: ProgramCategory
  tags: string[]
  aliases: string[]
}

/**
 * Build a compact text representation of the program for the prompt
 */
function buildProgramContext(input: CategorizationInput): string {
  const parts: string[] = [`Program name: ${input.name}`]
  if (input.description) parts.push(`Description: ${input.description}`)
  if (input.instructions.length > 0) {
    parts.push(`Instructions: ${input.instructions.slice(0, 20).join(', ')}`)
  }
  if (input.accounts.length > 0) {
    parts.push(`Account types: ${input.accounts.slice(0, 20).join(', ')}`)
  }
  return parts.join('\n')
}

/**
 * Call Cloudflare Workers AI to categorize a Solana program.
 * Falls back to { category: 'other', tags: [], aliases: [] } on any error.
 */
export async function categorizeProgramWithAI(
  ai: Ai,
  input: CategorizationInput,
): Promise<CategorizationResult> {
  const categories = CATEGORY_TAXONOMY.join(', ')
  const programContext = buildProgramContext(input)

  const systemPrompt = `You are an expert Solana ecosystem analyst. Classify Solana programs into exactly one category from this fixed taxonomy: ${categories}.

Rules:
- Reply ONLY with a JSON object — no markdown, no explanation.
- category: must be one of the taxonomy values listed above.
- tags: 3-7 lowercase hyphenated keywords that best describe what the program does (e.g. "swap", "liquidity-pool", "yield-farming"). Focus on technical function.
- aliases: 0-4 common short names or abbreviations for this program (e.g. "ray" for Raydium). Omit if unknown.

Response format (strict JSON):
{"category":"<one taxonomy value>","tags":["tag1","tag2"],"aliases":["alias1"]}`

  const userMessage = `Classify this Solana program:\n\n${programContext}`

  try {
    const response = await (ai as any).run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      max_tokens: 200,
      temperature: 0.1,
    })

    // Workers AI returns { response: string } for text models
    const rawText = (response as { response?: string }).response || ''

    // Extract the first JSON object from the response
    const jsonMatch = rawText.match(/\{[\s\S]*?\}/)
    if (!jsonMatch) {
      console.warn('[ai-categorization] No JSON in response:', rawText)
      return fallback()
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      category?: unknown
      tags?: unknown
      aliases?: unknown
    }

    const category = validateCategory(parsed.category)
    const tags = normalizeStringArray(parsed.tags).slice(0, 10)
    const aliases = normalizeStringArray(parsed.aliases).slice(0, 5)

    return { category, tags, aliases }
  } catch (err) {
    console.error('[ai-categorization] Error calling Workers AI:', err)
    return fallback()
  }
}

function validateCategory(value: unknown): ProgramCategory {
  if (typeof value === 'string' && (CATEGORY_TAXONOMY as readonly string[]).includes(value)) {
    return value as ProgramCategory
  }
  return 'other'
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean)
}

function fallback(): CategorizationResult {
  return { category: 'other', tags: [], aliases: [] }
}

/**
 * Extract instruction names from an Anchor IDL JSON object
 */
export function extractInstructionNames(idl: Record<string, any>): string[] {
  const instructions = idl?.instructions
  if (!Array.isArray(instructions)) return []
  return instructions
    .map((ix: any) => (typeof ix?.name === 'string' ? ix.name : null))
    .filter((n): n is string => n !== null)
}

/**
 * Extract account type names from an Anchor IDL JSON object
 */
export function extractAccountNames(idl: Record<string, any>): string[] {
  const accounts = idl?.accounts
  if (!Array.isArray(accounts)) return []
  return accounts
    .map((acc: any) => (typeof acc?.name === 'string' ? acc.name : null))
    .filter((n): n is string => n !== null)
}
