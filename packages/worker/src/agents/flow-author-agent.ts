/**
 * FlowAuthorAgent — the "smart" tool-calling replacement for the single-shot
 * `generateFlow()` path in flow-builder-generator.ts. Built on the Cloudflare
 * Agents SDK (Durable Object-backed) per the user's explicit request for a
 * real agentic loop, not a one-shot completion.
 *
 * Unlike flow-builder-generator.ts's fixed generate→parse→compile→repair
 * sequence, this agent reasons iteratively via the AI SDK's multi-step tool
 * loop (`generateText` + `stopWhen`): it can look up the existing flow
 * catalog for prior art, search related programs, validate/simulate its own
 * draft as many times as the step budget allows, and only finishes when it
 * calls `finalize_flow` — the terminal tool whose *arguments* (not free text)
 * are the authoritative result, matching the ai-sdk `hasToolCall` pattern.
 *
 * Called in-process from the Workflow via `getAgentByName(...).draftFlow()`
 * (DO RPC, same codebase — no HTTP/WebSocket hop needed; `@callable()` is
 * kept for parity/future external use per the Agents SDK's own guidance).
 */

import { Agent, callable } from 'agents'
import { generateText, tool, hasToolCall, isStepCount } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { z } from 'zod'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { registerAllNodes } from '../flow-engine'
import { compile, type FlowPlan } from '../flow-engine/compiler'
import { run } from '../flow-engine/interpreter'
import { FlowDocumentSchema, type FlowDocument } from '../flow-engine/fdl-schema'
import { getFlowSchemaDocument } from '../flow-engine/schema-docs'
import type { NodeContext } from '../flow-engine/types'
import { listFlows } from '../services/flow-catalog'
import { searchProjects } from '../services/search'
import { resolveSolanaRpcUrl, type SolanaRpcEnv } from '../utils/solana-rpc'

registerAllNodes()

export const FLOW_AUTHOR_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
const MAX_STEPS = 10
const MAX_SIMULATIONS_PER_DRAFT = 2

type Env = SolanaRpcEnv & {
  DB: D1Database
  AI: Ai
  CACHE: KVNamespace
  IDLS: KVNamespace
}

type AgentState = Record<string, never>

export interface DraftFlowInput {
  programId: string
  projectName: string
  idlJson: string
  cpiMd?: string | null
  existingFlow?: { fdlJson: string; inputCount: number; rpcCalls: number | null }
}

export type DraftFlowOutcome =
  | { kind: 'skip'; reason: string; steps: number; usage: { promptTokens: number; completionTokens: number }; transcript: string }
  | { kind: 'no_finalize'; steps: number; usage: { promptTokens: number; completionTokens: number }; transcript: string }
  | {
      kind: 'compiled'
      doc: FlowDocument
      plan: FlowPlan
      rationale: string
      steps: number
      usage: { promptTokens: number; completionTokens: number }
      transcript: string
    }

function buildSyntheticInputs(inputSpecs: FlowPlan['inputs']): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(inputSpecs)) {
    if (spec.default !== undefined) {
      inputs[key] = spec.default
      continue
    }
    switch (spec.type) {
      case 'pubkey':
        inputs[key] = '11111111111111111111111111111111'
        break
      case 'bool':
        inputs[key] = true
        break
      case 'string':
        inputs[key] = 'test'
        break
      default:
        inputs[key] = 1
    }
  }
  return inputs
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n...[truncated]`
}

export class FlowAuthorAgent extends Agent<Env, AgentState> {
  initialState: AgentState = {}

  @callable()
  async draftFlow(input: DraftFlowInput): Promise<DraftFlowOutcome> {
    const workersai = createWorkersAI({ binding: this.env.AI })
    const model = workersai(FLOW_AUTHOR_MODEL)

    const { rpcUrl } = resolveSolanaRpcUrl({ network: 'mainnet-beta', env: this.env })
    const nodeCtx: NodeContext = { db: this.env.DB, cache: this.env.CACHE, idls: this.env.IDLS, rpcUrl }

    let simulationsUsed = 0
    // Plain object (not separate `let`s) — sidesteps a TS control-flow
    // narrowing quirk where a nullable `let` reassigned only inside a
    // closure gets narrowed to `never` at the outer usage site.
    const terminal: { finalized: { fdl: unknown; rationale: string } | null; skipped: { reason: string } | null } = {
      finalized: null,
      skipped: null,
    }

    let searchFlowsUsed = 0
    let searchProgramsUsed = 0

    const tools = {
      search_similar_flows: tool({
        description: 'Search the published flow catalog for prior art. Call AT MOST ONCE — after that, move on to drafting regardless of what you find.',
        inputSchema: z.object({ query: z.string().optional(), intent: z.string().optional(), protocol: z.string().optional() }),
        execute: async ({ query, intent, protocol }) => {
          if (searchFlowsUsed >= 1) {
            return { message: 'already searched — stop searching and start drafting FDL now' }
          }
          searchFlowsUsed++
          const flows = await listFlows(this.env.DB, { query, intent, protocol, limit: 5 })
          return flows.length > 0 ? flows : { message: 'no matching published flows — proceed to drafting' }
        },
      }),
      search_programs: tool({
        description: 'Search the Orquestra program registry to confirm protocol identity. Call AT MOST ONCE — after that, move on to drafting regardless of what you find.',
        inputSchema: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          if (searchProgramsUsed >= 1) {
            return { message: 'already searched — stop searching and start drafting FDL now' }
          }
          searchProgramsUsed++
          const { results } = await searchProjects(this.env.DB, query, 5)
          return results.length > 0 ? results : { message: 'no matching programs — proceed to drafting' }
        },
      }),
      validate_flow: tool({
        description: 'Statically compile a draft FDL document — structure, unknown node types, cycles, dangling refs. No RPC calls. Call this before simulate_flow to catch mistakes cheaply.',
        inputSchema: z.object({ fdl: z.record(z.string(), z.any()) }),
        execute: async ({ fdl }) => {
          const parsed = FlowDocumentSchema.safeParse(fdl)
          if (!parsed.success) {
            return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
          }
          const compiled = await compile(parsed.data)
          if (!compiled.ok) {
            return { ok: false, errors: compiled.errors.map((e) => `${e.nodeId ?? e.path ?? ''}: ${e.message}`) }
          }
          return { ok: true, contentHash: compiled.plan.hash, strata: compiled.plan.strata.map((s) => s.map((n) => n.id)) }
        },
      }),
      simulate_flow: tool({
        description: `Compile AND RUN a draft FDL against real RPC with synthetic placeholder inputs — proves the graph actually resolves/executes. Budgeted: at most ${MAX_SIMULATIONS_PER_DRAFT} calls per draft, use validate_flow first to avoid wasting them on structural errors.`,
        inputSchema: z.object({ fdl: z.record(z.string(), z.any()) }),
        execute: async ({ fdl }) => {
          if (simulationsUsed >= MAX_SIMULATIONS_PER_DRAFT) {
            return { ok: false, errors: [`simulation budget exhausted (${MAX_SIMULATIONS_PER_DRAFT}/draft) — fix remaining issues via validate_flow reasoning, or finalize with your best draft`] }
          }
          const parsed = FlowDocumentSchema.safeParse(fdl)
          if (!parsed.success) {
            return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) }
          }
          const compiled = await compile(parsed.data)
          if (!compiled.ok) {
            return { ok: false, errors: compiled.errors.map((e) => `${e.nodeId ?? e.path ?? ''}: ${e.message}`) }
          }
          simulationsUsed++
          const result = await run(compiled.plan, buildSyntheticInputs(compiled.plan.inputs), nodeCtx)
          if (!result.ok) {
            return { ok: false, node: result.error.nodeId, error: result.error.message, simulationsRemaining: MAX_SIMULATIONS_PER_DRAFT - simulationsUsed }
          }
          return { ok: true, rpcCalls: result.rpcCalls, inputCount: Object.keys(compiled.plan.inputs).length, simulationsRemaining: MAX_SIMULATIONS_PER_DRAFT - simulationsUsed }
        },
      }),
      finalize_flow: tool({
        description: 'Terminal tool — call this exactly once, when your FDL has passed validate_flow (and ideally simulate_flow). Ends the session; its arguments are the final answer.',
        inputSchema: z.object({
          fdl: z.record(z.string(), z.any()).describe('The final FlowDocument JSON.'),
          rationale: z.string().describe('One or two sentences: what you built/optimized and why.'),
        }),
        execute: async ({ fdl, rationale }) => {
          terminal.finalized = { fdl, rationale }
          return { ok: true }
        },
      }),
      skip: tool({
        description: 'Terminal tool — call this instead of finalize_flow if, after investigation, no improvement over the existing flow is possible (optimization requests only).',
        inputSchema: z.object({ reason: z.string() }),
        execute: async ({ reason }) => {
          terminal.skipped = { reason }
          return { ok: true }
        },
      }),
    }

    const system = `You are an autonomous FDL author for the Orquestra Flow Engine, working inside a STRICTLY bounded agentic loop: ${MAX_STEPS} steps total, no more. Every step you spend investigating is a step you don't have for drafting/fixing. Follow this process, in order, and do not repeat a step:

1. (optional, at most 1 call) search_similar_flows for prior art.
2. (optional, at most 1 call) search_programs if protocol identity is unclear.
3. Draft the FDL yourself, right now, using the IDL/docs already given below — do not search again.
4. call validate_flow on your draft.
5. If it fails, fix the FDL yourself and validate_flow again (you have ${MAX_STEPS} steps total, budget them).
6. Once validate_flow passes, call simulate_flow (budgeted — at most ${MAX_SIMULATIONS_PER_DRAFT} calls).
7. Call finalize_flow with your best FDL — even if simulate_flow didn't fully pass, finalize_flow your best attempt rather than running out of steps with nothing. Or call skip if optimizing and no improvement is possible.

Never call finalize_flow and skip in the same turn. Do not call the same tool twice in a row with the same arguments.

FDL grammar and node-type catalog:
${getFlowSchemaDocument()}`

    const userSections = [
      `Program: ${input.projectName}`,
      `Program ID: ${input.programId}`,
      '',
      'IDL JSON:',
      truncate(input.idlJson, 10_000),
    ]
    if (input.cpiMd) userSections.push('', 'Documentation (cpi.md):', truncate(input.cpiMd, 6_000))
    if (input.existingFlow) {
      userSections.push(
        '',
        `Existing published flow: ${input.existingFlow.inputCount} inputs, ${input.existingFlow.rpcCalls ?? '?'} RPC calls.`,
        'Current FDL:',
        truncate(input.existingFlow.fdlJson, 6_000),
        '',
        'Investigate whether a strictly better version exists (fewer inputs or fewer RPC calls). If so, finalize_flow with the revision. If not, call skip with why.',
      )
    } else {
      userSections.push('', 'No published flow exists yet. Author one for the single most useful (typical caller-facing) instruction, minimizing declared inputs.')
    }

    const result = await generateText({
      model,
      system,
      prompt: userSections.join('\n'),
      tools,
      stopWhen: [hasToolCall('finalize_flow'), hasToolCall('skip'), isStepCount(MAX_STEPS)],
    })

    const usage = {
      promptTokens: (result.usage as any)?.inputTokens ?? (result.usage as any)?.promptTokens ?? 0,
      completionTokens: (result.usage as any)?.outputTokens ?? (result.usage as any)?.completionTokens ?? 0,
    }
    const transcript = result.steps.map((s, i) => `step ${i}: ${s.toolCalls.map((tc) => tc.toolName).join(', ') || '(text)'}`).join('\n')

    if (terminal.skipped) {
      return { kind: 'skip', reason: terminal.skipped.reason, steps: result.steps.length, usage, transcript }
    }
    if (!terminal.finalized) {
      return { kind: 'no_finalize', steps: result.steps.length, usage, transcript }
    }

    const fdlParsed = FlowDocumentSchema.safeParse(terminal.finalized.fdl)
    if (!fdlParsed.success) {
      return { kind: 'no_finalize', steps: result.steps.length, usage, transcript }
    }
    const compiled = await compile(fdlParsed.data)
    if (!compiled.ok) {
      return { kind: 'no_finalize', steps: result.steps.length, usage, transcript }
    }

    return {
      kind: 'compiled',
      doc: fdlParsed.data,
      plan: compiled.plan,
      rationale: terminal.finalized.rationale,
      steps: result.steps.length,
      usage,
      transcript,
    }
  }
}
