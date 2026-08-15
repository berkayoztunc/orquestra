/**
 * AI authoring core for the Flow Builder Agent (migration 026) — the bounded
 * generate → parse → compile → repair loop. Simulation (`run()` against real
 * RPC) is deliberately NOT done here — that needs a `NodeContext` (db/cache/
 * idls/rpcUrl) the workflow step already has to construct anyway, the same
 * way `flow-mcp.ts`'s `simulate_flow` tool does; keeping this file AI+compile
 * only makes it unit-testable without a live D1/RPC.
 */

import { compile, type FlowPlan } from '../flow-engine/compiler'
import { FlowDocumentSchema, type FlowDocument } from '../flow-engine/fdl-schema'
import { buildInitialPrompt, buildRepairPrompt, type AuthoringContext } from './flow-builder-prompt'

export const DEFAULT_FLOW_BUILDER_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
export const MAX_REPAIR_ATTEMPTS = 2

// Neuron pricing (developers.cloudflare.com/workers-ai/platform/pricing/, checked
// 2026-08): the 70B fp8-fast tier's published per-token rates (3.1's figures are
// the closest published tier to the 3.3 model used here — Cloudflare does not
// price every model variant separately). $0.011 per 1,000 Neurons.
const NEURONS_PER_INPUT_TOKEN = 26668 / 1_000_000
const NEURONS_PER_OUTPUT_TOKEN = 204805 / 1_000_000
const USD_PER_NEURON = 0.011 / 1000

export function estimateCost(promptTokens: number, completionTokens: number): { neurons: number; usd: number } {
  const neurons = promptTokens * NEURONS_PER_INPUT_TOKEN + completionTokens * NEURONS_PER_OUTPUT_TOKEN
  return { neurons, usd: neurons * USD_PER_NEURON }
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      // fall through to extraction below
    }
  }
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

export interface GenerateFlowInput {
  ai: Ai
  ctx: AuthoringContext
  model?: string
}

export interface GenerateFlowUsage {
  promptTokens: number
  completionTokens: number
}

export type GenerateFlowOutcome =
  | { kind: 'skip'; reason: string; rounds: number; usage: GenerateFlowUsage }
  | { kind: 'compile_failed'; errors: string[]; rounds: number; lastDraftRaw: string; usage: GenerateFlowUsage }
  | {
      kind: 'compiled'
      doc: FlowDocument
      plan: FlowPlan
      rationale: string
      rounds: number
      rawResponse: string
      usage: GenerateFlowUsage
    }

/**
 * Runs up to `1 + MAX_REPAIR_ATTEMPTS` AI calls: an initial draft, then bounded
 * repair attempts fed the compiler's own error list. Never loops unbounded —
 * after `MAX_REPAIR_ATTEMPTS` failed repairs it returns `compile_failed`.
 */
export async function generateFlow(input: GenerateFlowInput): Promise<GenerateFlowOutcome> {
  const model = input.model ?? DEFAULT_FLOW_BUILDER_MODEL
  let prompt = buildInitialPrompt(input.ctx)
  let lastRaw = ''
  let lastErrors: string[] = []
  let promptTokens = 0
  let completionTokens = 0

  for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
    const rounds = attempt + 1
    let response: any
    try {
      response = await (input.ai as any).run(model, {
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 3000,
        temperature: 0.2,
      })
    } catch (err) {
      console.error('[flow-builder-generator] Workers AI call failed:', err)
      lastErrors = [`AI call failed: ${err instanceof Error ? err.message : String(err)}`]
      continue
    }

    lastRaw = (response?.response as string) || ''
    promptTokens += response?.usage?.prompt_tokens ?? 0
    completionTokens += response?.usage?.completion_tokens ?? 0

    const parsedJson = extractJsonObject(lastRaw)
    if (!parsedJson) {
      lastErrors = ['response was not valid JSON']
      prompt = buildRepairPrompt(input.ctx, lastRaw, lastErrors)
      continue
    }

    if (parsedJson.skip === true) {
      return {
        kind: 'skip',
        reason: typeof parsedJson.reason === 'string' ? parsedJson.reason : 'model declined to propose an improvement',
        rounds,
        usage: { promptTokens, completionTokens },
      }
    }

    const rationale = typeof parsedJson.rationale === 'string' ? parsedJson.rationale : ''
    const fdlParsed = FlowDocumentSchema.safeParse(parsedJson.fdl)
    if (!fdlParsed.success) {
      lastErrors = fdlParsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      prompt = buildRepairPrompt(input.ctx, JSON.stringify(parsedJson.fdl ?? {}), lastErrors)
      continue
    }

    const compiled = await compile(fdlParsed.data)
    if (!compiled.ok) {
      lastErrors = compiled.errors.map((e) => `${e.nodeId ?? e.path ?? ''}: ${e.message}`)
      prompt = buildRepairPrompt(input.ctx, JSON.stringify(fdlParsed.data), lastErrors)
      continue
    }

    return {
      kind: 'compiled',
      doc: fdlParsed.data,
      plan: compiled.plan,
      rationale,
      rounds,
      rawResponse: lastRaw,
      usage: { promptTokens, completionTokens },
    }
  }

  return {
    kind: 'compile_failed',
    errors: lastErrors,
    rounds: MAX_REPAIR_ATTEMPTS + 1,
    lastDraftRaw: lastRaw,
    usage: { promptTokens, completionTokens },
  }
}
