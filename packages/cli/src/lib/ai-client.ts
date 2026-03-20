/**
 * Cloudflare Workers AI REST client for generating IDL descriptions.
 *
 * Uses the Cloudflare REST API (not the Workers AI binding) so it works from Node/Bun CLI.
 * Required env vars:
 *   CF_ACCOUNT_ID  — Cloudflare account ID
 *   CF_API_TOKEN   — API token with "Workers AI:Run" permission
 *   CF_AI_MODEL    — model ID (default: @cf/meta/llama-3.1-8b-instruct)
 */

export interface AIClientOptions {
  accountId: string
  apiToken: string
  model: string
  timeoutMs?: number
}

export interface IDLSummary {
  programName: string
  programId: string
  instructionCount: number
  instructionNames: string[]
  accountCount: number
  errorCount: number
  eventCount: number
}

export interface AIResult {
  shortDescription: string
  analysisJson: string
  modelUsed: string
  generatedAt: string
}

/**
 * Build a compact IDL summary for the AI prompt.
 * We don't send the full IDL to avoid blowing the token limit.
 */
export function buildIDLSummary(idl: Record<string, any>, programId: string): IDLSummary {
  const programName: string =
    (typeof idl.name === 'string' ? idl.name : null) ||
    (idl.metadata && typeof idl.metadata.name === 'string' ? idl.metadata.name : null) ||
    programId

  const instructions: any[] = Array.isArray(idl.instructions) ? idl.instructions : []
  const accounts: any[] = Array.isArray(idl.accounts) ? idl.accounts : []
  const errors: any[] = Array.isArray(idl.errors) ? idl.errors : []
  const events: any[] = Array.isArray(idl.events) ? idl.events : []

  return {
    programName,
    programId,
    instructionCount: instructions.length,
    instructionNames: instructions.slice(0, 20).map((ix) => ix.name ?? ''),
    accountCount: accounts.length,
    errorCount: errors.length,
    eventCount: events.length,
  }
}

/**
 * Call the Cloudflare Workers AI REST API to generate a short description
 * and structured analysis JSON for a Solana Anchor IDL.
 *
 * Returns null if the AI call fails — callers should handle gracefully.
 */
export async function generateDescription(
  idl: Record<string, any>,
  programId: string,
  opts: AIClientOptions,
): Promise<AIResult | null> {
  const summary = buildIDLSummary(idl, programId)

  const systemPrompt = `You are an expert Solana smart contract analyst. Given a brief description of an Anchor program, you output:
1. A single concise English sentence (max 150 characters) describing what the program does — its main purpose.
2. A JSON object (nothing else — no markdown fences) with keys: summary (string), tags (string[]).

Respond ONLY with exactly two lines:
LINE1: <description sentence>
LINE2: <raw JSON object>`

  const userPrompt = `Program: ${summary.programName}
Program ID: ${summary.programId}
Instructions (${summary.instructionCount}): ${summary.instructionNames.join(', ')}
Accounts: ${summary.accountCount}
Errors: ${summary.errorCount}
Events: ${summary.eventCount}

Describe this Solana program in one sentence, then provide the JSON object.`

  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/ai/run/${opts.model}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const body = await response.text()
      console.error(`[ai-client] HTTP ${response.status}: ${body.slice(0, 200)}`)
      return null
    }

    const data = await response.json() as { success: boolean; result?: { response?: string } }

    if (!data.success || !data.result?.response) {
      console.error('[ai-client] Unexpected response shape:', JSON.stringify(data).slice(0, 300))
      return null
    }

    const raw = data.result.response.trim()
    const lines = raw.split('\n').map((l: string) => l.trim()).filter(Boolean)

    if (lines.length < 2) {
      // Fallback: treat whole response as description
      return {
        shortDescription: raw.slice(0, 200),
        analysisJson: JSON.stringify({ summary: raw.slice(0, 200), tags: [] }),
        modelUsed: opts.model,
        generatedAt: new Date().toISOString(),
      }
    }

    const shortDescription = lines[0].slice(0, 200)

    // Find JSON line — sometimes the model adds extra text
    let analysisJson = JSON.stringify({ summary: shortDescription, tags: [] })
    for (let i = 1; i < lines.length; i++) {
      const candidate = lines[i]
      if (candidate.startsWith('{')) {
        try {
          JSON.parse(candidate) // validate
          analysisJson = candidate
          break
        } catch {
          // not valid JSON, continue
        }
      }
    }

    return {
      shortDescription,
      analysisJson,
      modelUsed: opts.model,
      generatedAt: new Date().toISOString(),
    }
  } catch (err: any) {
    clearTimeout(timeoutId)
    if (err.name === 'AbortError') {
      console.error('[ai-client] Timeout — skipping AI description')
    } else {
      console.error('[ai-client] Error:', err.message)
    }
    return null
  }
}

/** Load AI client options from environment variables. Throws if required vars are missing. */
export function loadAIClientOptions(): AIClientOptions | null {
  const accountId = process.env.CF_ACCOUNT_ID
  const apiToken = process.env.CF_API_TOKEN
  const model = process.env.CF_AI_MODEL ?? '@cf/meta/llama-3.1-8b-instruct'

  if (!accountId || !apiToken) {
    return null
  }

  return { accountId, apiToken, model }
}
