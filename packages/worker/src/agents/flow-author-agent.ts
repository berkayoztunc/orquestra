/**
 * FlowAuthorAgent — Cloudflare Agents SDK Durable Object that authors Orquestra
 * FDL flow documents through a bounded agentic tool loop (ai-sdk `generateText`
 * + `stopWhen`), rather than a single-shot completion.
 *
 * Design notes, all of them driven by observed production failures:
 *
 * - **Research tools, not a prompt dump.** The IDL used to be pasted into the
 *   prompt truncated at 10k chars, which mangles any large program. Instead the
 *   agent pulls what it needs: `list_instructions` → `get_instruction_detail`
 *   → `read_program_docs`.
 *
 * - **`get_instruction_detail` pre-classifies and pre-translates.**
 *   `listPdaAccounts()` skips accounts with no `pda.seeds`, so the set it
 *   returns IS the "derivable on-chain" set — an exact oracle for
 *   Resolvable-vs-Input, instead of something the model has to infer. It also
 *   translates the IDL's seed vocabulary (`const`/`arg`/`account`) into
 *   `resolve.pda@1`'s completely different one (bare string / pubkey / string /
 *   bytes / ints). A model passing IDL seed kinds straight through is exactly
 *   what produced the `unknown seed kind "const"` failure in production.
 *
 * - **Phased `prepareStep` + forced finalize.** Earlier runs burned every step
 *   re-calling one search tool and returned nothing. Research tools are removed
 *   from the schema after the research phase, and the final step forces
 *   `finalize_flow` via `toolChoice`, so "ran out of steps with nothing" is
 *   structurally impossible rather than merely discouraged.
 *
 * Called in-process from the Workflow via `getAgentByName(...).draftFlow()`
 * (DO RPC, same codebase); `@callable()` is kept for external use.
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
import type { NodeContext } from '../flow-engine/types'
import { listFlows } from '../services/flow-catalog'
import { fetchIDL } from '../services/idl-fetch'
import { generateDocumentation } from '../services/doc-generator'
import { listPdaAccounts, type PdaAccountInfo } from '../services/pda'
import { queryProgramAccounts } from '../services/program-accounts'
import { detectAccountType, deserializeAccountData } from '../services/account-parser'
import { fetchAccountInfo } from '../utils/solana-rpc'
import { normalizeAccountMeta, expandInstructionArgs, getInstruction } from '../services/idl-parser'
import { buildSyntheticInputs, SIMULATION_WALLET } from '../services/flow-simulation-inputs'
import { resolveSolanaRpcUrl, type SolanaRpcEnv } from '../utils/solana-rpc'
import { flowAuthorSystemPrompt } from './flow-author-prompt'
import { lintReferences, lintDeliverable } from './flow-lint'

registerAllNodes()

export const FLOW_AUTHOR_MODEL = '@cf/moonshotai/kimi-k2.7-code'

/** Total tool-loop steps, including the forced finalize on the last one. */
const MAX_STEPS = 14
/**
 * Step phases. Two boundaries, not one — an earlier version had only a hard
 * wall at step 5, which blocked a model that was ready to build early (it
 * emitted prose and the run died); removing the wall entirely then let a model
 * research for all 13 steps on a large program and never build at all.
 *
 *   [0, RESEARCH_ONLY_STEPS)      research only  — front-load investigation
 *   [RESEARCH_ONLY_STEPS, RESEARCH_DEADLINE)  research + build — start when ready
 *   [RESEARCH_DEADLINE, MAX-1)    build only     — research withdrawn, must build
 *   MAX-1                         forced finalize
 */
const RESEARCH_ONLY_STEPS = 2
const RESEARCH_DEADLINE = 8
// Raised from 3 after a real run spent 4 simulate calls genuinely iterating on
// its own errors and hit the cap with steps still left. Simulations cost RPC,
// not AI tokens, and they are the gate on whether a flow gets proposed at all.
const MAX_SIMULATIONS_PER_DRAFT = 5
// Cost controls. Every tool result stays in the conversation and is re-sent on
// every later step, so a single fat result is paid for many times over: one
// 20k-char doc read cost roughly half of a $0.25 run. Keep results small.
const MAX_DOC_CHARS = 6_000
const MAX_DOC_READS = 2

const RESEARCH_TOOLS = ['list_instructions', 'get_instruction_detail', 'read_program_docs', 'find_real_account', 'read_account_data', 'search_similar_flows'] as const
const BUILD_TOOLS = ['validate_flow', 'simulate_flow', 'finalize_flow', 'skip'] as const

type Env = SolanaRpcEnv & {
  DB: D1Database
  AI: Ai
  CACHE: KVNamespace
  IDLS: KVNamespace
  API_BASE_URL?: string
}

type AgentState = Record<string, never>

export interface DraftFlowInput {
  /** Project UUID — REQUIRED by `orquestra.build_instruction@1`'s `projectId` field. */
  projectId: string
  programId: string
  projectName: string
  cpiMd?: string | null
  existingFlow?: { fdlJson: string; inputCount: number; rpcCalls: number | null }
}

type Usage = { promptTokens: number; completionTokens: number }

export type DraftFlowOutcome =
  | { kind: 'skip'; reason: string; steps: number; usage: Usage; transcript: string }
  | { kind: 'no_finalize'; steps: number; usage: Usage; transcript: string; errors?: string[] }
  | {
      kind: 'compiled'
      doc: FlowDocument
      plan: FlowPlan
      rationale: string
      steps: number
      usage: Usage
      transcript: string
      /** The inputs the agent simulated with — real addresses it discovered, not
       *  placeholders. Downstream re-simulation MUST reuse these or it will be
       *  testing a different (and meaningless) scenario. */
      simulationInputs: Record<string, unknown>
    }

function hexToBase64(hex: string): string {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return btoa(String.fromCharCode(...bytes))
}

/** Map an IDL arg/account seed type onto a `resolve.pda@1` seed kind. */
function flowSeedKindForType(type: string | undefined): string {
  const t = (type ?? '').toLowerCase()
  if (t === 'pubkey' || t === 'publickey') return 'pubkey'
  if (t === 'string') return 'string'
  if (/^[ui](8|16|32|64|128)$/.test(t)) return t
  return 'pubkey'
}

/**
 * Translate one account's IDL seed metadata into a ready-to-paste
 * `resolve.pda@1` `seeds` array. IDL seed kinds (`const`/`arg`/`account`/
 * `account_field`) are NOT valid flow-engine seed kinds — this is the
 * translation the model must never be asked to do itself.
 */
function translateSeeds(info: PdaAccountInfo): { seeds: unknown[]; notes: string[] } {
  const seeds: unknown[] = []
  const notes: string[] = []

  for (const s of info.seeds) {
    if (s.kind === 'const') {
      const desc = s.description ?? ''
      if (desc.startsWith('0x')) {
        seeds.push({ kind: 'bytes', value: hexToBase64(desc) })
      } else {
        // resolve.pda@1 accepts a bare string as raw UTF-8 seed bytes.
        seeds.push(desc)
      }
      continue
    }
    if (s.kind === 'arg') {
      seeds.push({ kind: flowSeedKindForType(s.type), value: `$inputs.${s.name ?? 'TODO'}` })
      notes.push(`seed "${s.name}" comes from instruction arg "${s.name}" (type ${s.type ?? 'unknown'}) — wire it to a flow input or an upstream node output`)
      continue
    }
    if (s.kind === 'account') {
      seeds.push({ kind: 'pubkey', value: `$inputs.${s.name ?? 'TODO'}` })
      notes.push(`seed "${s.name}" is the address of the "${s.name}" account in this same instruction — reuse whatever value/node you already use for that account instead of adding a new input`)
      continue
    }
    if (s.kind === 'account_field') {
      seeds.push({ kind: flowSeedKindForType(s.type), value: `$TODO_read_${(s.name ?? '').split('.')[0]}` })
      notes.push(`seed "${s.name}" reads a field from an on-chain account — resolve.pda@1 cannot read chain state, so add a resolve.pda_state@1 (or resolve.account_data@1) node first and chain this seed off its output`)
      continue
    }
    notes.push(`seed kind "${s.kind}" has no direct flow-engine equivalent — inspect manually`)
  }

  return { seeds, notes }
}

/** The SPL Associated Token Account program — a cross-program PDA owner. */
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'

/**
 * True when an instruction account is an associated token account. The strong
 * signal is an IDL PDA whose `customProgram` is the ATA program; the name
 * heuristic covers programs that document the account without PDA metadata.
 * Getting this right matters because an ATA must be produced by
 * `resolve.ata@1` (owner + mint), never declared as a flow input.
 */
function looksLikeAta(accountName: string, pdaInfo?: PdaAccountInfo): boolean {
  if (pdaInfo?.customProgram === ATA_PROGRAM) return true
  return /ata|associated.?token|token.?account/i.test(accountName)
}

export class FlowAuthorAgent extends Agent<Env, AgentState> {
  initialState: AgentState = {}

  @callable()
  async draftFlow(input: DraftFlowInput): Promise<DraftFlowOutcome> {
    const workersai = createWorkersAI({ binding: this.env.AI })
    // `sessionAffinity` is translated by workers-ai-provider into the
    // `x-session-affinity` header, which pins all steps of one candidate to the
    // same replica so Workers AI's prefix cache actually hits. That matters a
    // lot here: a tool loop re-sends the whole conversation every step, and
    // cached input is $0.19/M vs $0.95/M. Keyed per-program (not globally) so
    // traffic still spreads across replicas.
    const model = workersai(FLOW_AUTHOR_MODEL, {
      sessionAffinity: `flow-author:${input.programId}`,
      reasoning_effort: 'low',
    } as any)

    const { rpcUrl } = resolveSolanaRpcUrl({ network: 'mainnet-beta', env: this.env })
    const nodeCtx: NodeContext = { db: this.env.DB, cache: this.env.CACHE, idls: this.env.IDLS, rpcUrl }

    let simulationsUsed = 0
    let docReadsUsed = 0
    // Plain object rather than separate `let`s — TS narrows a nullable `let`
    // that is only reassigned inside a closure to `never` at the usage site.
    const terminal: { finalized: { fdl: unknown; rationale: string } | null; skipped: { reason: string } | null } = {
      finalized: null,
      skipped: null,
    }
    /** Last validate/simulate errors, surfaced when the model finalizes something broken. */
    let lastErrors: string[] = []
    /** Content hash of the last draft that simulated cleanly — finalize is gated on this. */
    let lastSimulatedHash: string | null = null
    /** Inputs used for the passing simulation, carried out with the draft. */
    let lastSimInputs: Record<string, unknown> = {}
    /** Best draft seen so far, used as a fallback if the model never finalizes.
     *  Held in a container for the same TS control-flow reason as `terminal`. */
    const draftState: { lastGood: { doc: FlowDocument; plan: FlowPlan; simulated: boolean } | null } = { lastGood: null }
    /** Set by prepareStep on the forced-finalize step, which bypasses the simulation gate. */
    let forcedFinalStep = false

    const loadIdl = async () => fetchIDL(input.projectId, this.env)

    const tools = {
      list_instructions: tool({
        description: 'List every instruction in this program with its account and argument counts. Start here to pick which instruction the flow should build.',
        inputSchema: z.object({}),
        execute: async () => {
          const data = await loadIdl()
          if (!data) return { error: `project ${input.projectId} not found or not public` }
          const instructions = (data.idl.instructions ?? []).map((ix: any) => ({
            name: ix.name,
            accounts: (ix.accounts ?? []).length,
            args: (ix.args ?? []).length,
            docs: Array.isArray(ix.docs) ? ix.docs.join(' ').slice(0, 200) : undefined,
          }))
          return { programId: data.programId, instructionCount: instructions.length, instructions }
        },
      }),

      get_instruction_detail: tool({
        description:
          'Full detail for ONE instruction, with every account already classified as Constant / Resolvable / Input, and PDA seeds already translated into valid resolve.pda@1 form. This is the tool that tells you which accounts you do NOT need to declare as flow inputs — call it before writing any FDL.',
        inputSchema: z.object({ name: z.string().describe('Instruction name from list_instructions.') }),
        execute: async ({ name }) => {
          const data = await loadIdl()
          if (!data) return { error: `project ${input.projectId} not found or not public` }

          const ix = getInstruction(data.idl, name)
          if (!ix) return { error: `instruction "${name}" not found — call list_instructions for valid names` }

          const pdaInfos = listPdaAccounts(data.idl).filter((p) => p.instruction === ix.name)
          const pdaByAccount = new Map(pdaInfos.map((p) => [p.account, p]))

          const accounts = (ix.accounts ?? []).map((raw: any) => {
            const meta = normalizeAccountMeta(raw)
            const pdaInfo = pdaByAccount.get(meta.name)

            if (meta.address) {
              return {
                name: meta.name,
                isMut: meta.isMut,
                isSigner: meta.isSigner,
                isOptional: meta.isOptional,
                verdict: 'Constant',
                hardcodeAddress: meta.address,
              }
            }
            if (looksLikeAta(meta.name, pdaInfo)) {
              return {
                name: meta.name,
                isMut: meta.isMut,
                isSigner: meta.isSigner,
                isOptional: meta.isOptional,
                verdict: 'Resolvable',
                resolveWith: 'resolve.ata@1',
                nodeTemplate: {
                  type: 'resolve.ata@1',
                  in: { owner: '<owner pubkey ref>', mint: '<mint pubkey ref>' },
                },
                seedNotes: [
                  'This is an associated token account: produce it with resolve.ata@1 from an owner and a mint. Never declare an ATA as a flow input.',
                  'resolve.ata@1 outputs { address, exists, createIx, tokenProgram }. Use $node.address for this account.',
                  'If the instruction also takes a *_token_program account, read $node.tokenProgram instead of adding an input.',
                  'If the ATA may not exist yet, include $node.createIx? in compose_transaction instructions to create it.',
                ],
              }
            }
            if (pdaInfo) {
              const { seeds, notes } = translateSeeds(pdaInfo)
              return {
                name: meta.name,
                isMut: meta.isMut,
                isSigner: meta.isSigner,
                isOptional: meta.isOptional,
                verdict: 'Resolvable',
                resolveWith: 'resolve.pda@1',
                suggestedSeeds: seeds,
                seedNotes: notes,
                customProgram: pdaInfo.customProgram,
              }
            }
            return {
              name: meta.name,
              isMut: meta.isMut,
              isSigner: meta.isSigner,
              isOptional: meta.isOptional,
              verdict: 'Input',
            }
          })

          let args: unknown[] = []
          try {
            args = expandInstructionArgs(data.idl, (ix.args ?? []) as any).map((a: any) => ({
              name: a.name,
              type: a.typeStr,
              fields: a.fields?.map((f: any) => ({ name: f.name, type: f.typeStr })),
            }))
          } catch {
            args = (ix.args ?? []).map((a: any) => ({ name: a.name, type: String(a.type) }))
          }

          const inputCount = accounts.filter((a) => a.verdict === 'Input').length
          return {
            instruction: ix.name,
            projectId: input.projectId,
            accounts,
            args,
            summary: `${accounts.length} accounts: ${accounts.filter((a) => a.verdict === 'Constant').length} Constant, ${accounts.filter((a) => a.verdict === 'Resolvable').length} Resolvable, ${inputCount} Input. Plus ${args.length} args.`,
          }
        },
      }),

      read_program_docs: tool({
        description: `Read a section of the generated program documentation (llms.txt). Use "pdaAccounts" for PDA seed layouts. Prefer get_instruction_detail first — it is more precise. Limit: ${MAX_DOC_READS} calls.`,
        inputSchema: z.object({
          section: z.enum(['overview', 'instructions', 'pdaAccounts', 'accounts']).describe('Which section to read.'),
        }),
        execute: async ({ section }) => {
          if (docReadsUsed >= MAX_DOC_READS) {
            return { error: `documentation read limit (${MAX_DOC_READS}) reached — use get_instruction_detail, or start drafting` }
          }
          docReadsUsed++
          const data = await loadIdl()
          if (!data) return { error: `project ${input.projectId} not found or not public` }
          const docs = generateDocumentation(
            data.idl,
            data.programId,
            this.env.API_BASE_URL ?? 'https://api.orquestra.dev',
            input.projectId,
            input.cpiMd ?? data.cpiMd,
          )
          // Never return `docs.full` — it is unbounded and can be hundreds of KB.
          const text = docs[section] ?? ''
          return { section, text: text.length > MAX_DOC_CHARS ? `${text.slice(0, MAX_DOC_CHARS)}\n...[truncated]` : text }
        },
      }),

      find_real_account: tool({
        description:
          'Find REAL live on-chain accounts of a given IDL account type for this program, and return their addresses. Use this when a flow input is a specific on-chain account (a pool, market, vault, config) rather than a wallet: pass one of these addresses to simulate_flow so the simulation reads a genuine account instead of a placeholder.',
        inputSchema: z.object({ accountType: z.string().describe('IDL account type name, e.g. "Pool".') }),
        execute: async ({ accountType }) => {
          const data = await loadIdl()
          if (!data) return { error: `project ${input.projectId} not found or not public` }
          try {
            const result = await queryProgramAccounts({
              idl: data.idl,
              programId: data.programId,
              rpcUrl,
              cluster: 'mainnet-beta',
              input: { accountType, limit: 3 },
            })
            if (result.count === 0) {
              return { accountType, addresses: [], message: 'no live accounts of this type — do not make it a flow input you cannot simulate' }
            }
            return { accountType, addresses: result.accounts.map((a) => a.address) }
          } catch (err) {
            return { error: `lookup failed: ${err instanceof Error ? err.message : String(err)}` }
          }
        },
      }),

      read_account_data: tool({
        description:
          'Fetch and decode a REAL on-chain account, returning its exact decoded field names and values. Use this before referencing $someNode.data.<field> anywhere — field names must match the decoded account exactly (they are usually snake_case from the IDL). Never build a throwaway flow just to inspect an account; use this instead.',
        inputSchema: z.object({ address: z.string().describe('Account address, e.g. from find_real_account.') }),
        execute: async ({ address }) => {
          const data = await loadIdl()
          if (!data) return { error: `project ${input.projectId} not found or not public` }
          try {
            const info = await fetchAccountInfo(address, rpcUrl)
            if (!info) return { error: `no account at ${address}` }
            const raw = Uint8Array.from(atob(info.data), (ch) => ch.charCodeAt(0))
            const accountDef = await detectAccountType(raw, data.idl)
            if (!accountDef) {
              return { address, owner: info.owner, error: 'not decodable as any account type in this IDL — wrong address for this program?' }
            }
            const decoded = deserializeAccountData(raw, accountDef, data.idl)
            return {
              address,
              accountType: accountDef.name,
              fields: Object.keys(decoded),
              decoded: JSON.parse(JSON.stringify(decoded, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))),
            }
          } catch (err) {
            return { error: `decode failed: ${err instanceof Error ? err.message : String(err)}` }
          }
        },
      }),

      search_similar_flows: tool({
        description: 'Search the published flow catalog for prior art — flows for similar protocols/intents whose node patterns you can borrow.',
        inputSchema: z.object({ query: z.string().optional(), intent: z.string().optional(), protocol: z.string().optional() }),
        execute: async ({ query, intent, protocol }) => {
          const flows = await listFlows(this.env.DB, { query, intent, protocol, limit: 3 })
          if (flows.length === 0) return { message: 'no matching published flows' }
          // Slugs + input shapes only: the full node graphs would sit in context
          // for the rest of the run at no real benefit.
          return flows.map((f: any) => ({ slug: f.slug, intent: f.intent, protocol: f.protocol, inputs: Object.keys(f.inputs ?? {}) }))
        },
      }),

      validate_flow: tool({
        description: 'Statically compile a draft FDL document — structure, unknown node types, cycles, dangling refs. No RPC. Always call this before simulate_flow.',
        inputSchema: z.object({ fdl: z.record(z.string(), z.any()) }),
        execute: async ({ fdl }) => {
          const parsed = FlowDocumentSchema.safeParse(fdl)
          if (!parsed.success) {
            lastErrors = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            return { ok: false, errors: lastErrors }
          }
          const compiled = await compile(parsed.data)
          if (!compiled.ok) {
            lastErrors = compiled.errors.map((e) => `${e.nodeId ?? e.path ?? ''}: ${e.message}`)
            return { ok: false, errors: lastErrors }
          }
          // Catches refs to fields a node does not emit — the compiler only
          // checks the ref's root, so these otherwise crash mid-simulation.
          const refErrors = lintReferences(parsed.data)
          if (refErrors.length > 0) {
            lastErrors = refErrors.map((e) => `${e.nodeId}: ${e.message}`)
            return { ok: false, errors: lastErrors }
          }
          lastErrors = []
          if (lintDeliverable(parsed.data).length === 0 && !draftState.lastGood?.simulated) draftState.lastGood = { doc: parsed.data, plan: compiled.plan, simulated: false }
          return {
            ok: true,
            contentHash: compiled.plan.hash,
            inputCount: Object.keys(compiled.plan.inputs).length,
            declaredInputs: Object.keys(compiled.plan.inputs),
            strata: compiled.plan.strata.map((s) => s.map((n) => n.id)),
            next: 'Now call simulate_flow on this exact document — finalize_flow will be rejected until a simulation passes.',
          }
        },
      }),

      simulate_flow: tool({
        description: `Compile AND RUN a draft FDL against real mainnet RPC using a real funded wallet (${SIMULATION_WALLET}) for every pubkey input. This is the gate: a flow that does not simulate cleanly will not be proposed. Budget: ${MAX_SIMULATIONS_PER_DRAFT} calls.`,
        inputSchema: z.object({
          fdl: z.record(z.string(), z.any()),
          inputs: z
            .record(z.string(), z.any())
            .optional()
            .describe(
              'Optional real values for specific flow inputs, e.g. { "pool": "<address from find_real_account>" }. Anything omitted is filled automatically, but a pubkey input that is a specific on-chain account (pool/market/vault) MUST be supplied here — the automatic value is a wallet, which will not decode as that account type.',
            ),
        }),
        execute: async ({ fdl, inputs: providedInputs }) => {
          if (simulationsUsed >= MAX_SIMULATIONS_PER_DRAFT) {
            return { ok: false, errors: [`simulation budget exhausted (${MAX_SIMULATIONS_PER_DRAFT}) — finalize your best draft now`] }
          }
          const parsed = FlowDocumentSchema.safeParse(fdl)
          if (!parsed.success) {
            lastErrors = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
            return { ok: false, errors: lastErrors }
          }
          const compiled = await compile(parsed.data)
          if (!compiled.ok) {
            lastErrors = compiled.errors.map((e) => `${e.nodeId ?? e.path ?? ''}: ${e.message}`)
            return { ok: false, errors: lastErrors }
          }
          simulationsUsed++
          // Model-supplied values win; the rest are filled in automatically.
          const simInputs = { ...buildSyntheticInputs(compiled.plan.inputs), ...(providedInputs ?? {}) }
          const result = await run(compiled.plan, simInputs, nodeCtx)
          if (!result.ok) {
            lastErrors = [`${result.error.nodeId ?? '(top-level)'}: ${result.error.message}`]
            // "_bn" undefined is an opaque PublicKey failure that always means a
            // $ref resolved to undefined. Say so, with the usual cause, instead
            // of leaving the model to guess (it burned several runs guessing).
            const undefinedRef = /reading '_bn'|undefined/.test(result.error.message)
            return {
              ok: false,
              node: result.error.nodeId,
              error: result.error.message,
              hint: undefinedRef
                ? `A value passed to "${result.error.nodeId}" was undefined. Usually one of: (a) a $ref to a nested field whose parent was null — e.g. resolve.account_data@1 returns data:null when the address is not an account of that type, so $x.data.foo is undefined; or (b) simulating an on-chain-account input with the default placeholder wallet. Use find_real_account and pass a real address via this tool's "inputs" argument.`
                : undefined,
              simulationsRemaining: MAX_SIMULATIONS_PER_DRAFT - simulationsUsed,
            }
          }
          lastErrors = []
          lastSimulatedHash = compiled.plan.hash
          lastSimInputs = simInputs
          if (lintDeliverable(parsed.data).length === 0) draftState.lastGood = { doc: parsed.data, plan: compiled.plan, simulated: true }
          return {
            ok: true,
            rpcCalls: result.rpcCalls,
            inputCount: Object.keys(compiled.plan.inputs).length,
            declaredInputs: Object.keys(compiled.plan.inputs),
            simulationsRemaining: MAX_SIMULATIONS_PER_DRAFT - simulationsUsed,
            next: 'Simulation passed. If you cannot reduce the input count further, call finalize_flow with this exact document.',
          }
        },
      }),

      finalize_flow: tool({
        description: 'Terminal tool — submit your final FDL. Call exactly once, ideally after simulate_flow returned ok:true.',
        inputSchema: z.object({
          fdl: z.record(z.string(), z.any()).describe('The final FlowDocument JSON.'),
          rationale: z.string().describe('One or two sentences: what you built/optimized, and how you kept the input count low.'),
        }),
        execute: async ({ fdl, rationale }) => {
          // Accept bar: a flow that hasn't simulated cleanly is never proposed,
          // so refuse to finalize one — unless this is the forced final step,
          // where taking the best available draft beats returning nothing.
          if (!forcedFinalStep) {
            const parsed = FlowDocumentSchema.safeParse(fdl)
            if (!parsed.success) {
              return { ok: false, error: 'that document is not valid FDL — call validate_flow and fix it first' }
            }
            const compiled = await compile(parsed.data)
            if (!compiled.ok) {
              return { ok: false, error: 'that document does not compile — call validate_flow and fix it first' }
            }
            if (compiled.plan.hash !== lastSimulatedHash) {
              return {
                ok: false,
                error: 'finalize_flow requires a passing simulate_flow of this EXACT document. Call simulate_flow on it first.',
              }
            }
            const shape = lintDeliverable(parsed.data)
            if (shape.length > 0) {
              return { ok: false, error: `not a publishable flow: ${shape.join('; ')}` }
            }
          }
          terminal.finalized = { fdl, rationale }
          return { ok: true }
        },
      }),

      skip: tool({
        description: 'Terminal tool — only for optimization requests where, after investigation, no improvement over the existing flow is possible.',
        inputSchema: z.object({ reason: z.string() }),
        execute: async ({ reason }) => {
          terminal.skipped = { reason }
          return { ok: true }
        },
      }),
    }

    const userSections = [
      `Program: ${input.projectName}`,
      `Program address: ${input.programId}`,
      `projectId (use this EXACT value for every orquestra.build_instruction@1 "projectId" field): ${input.projectId}`,
    ]
    if (input.existingFlow) {
      userSections.push(
        '',
        `An existing published flow covers this program: ${input.existingFlow.inputCount} inputs, ${input.existingFlow.rpcCalls ?? '?'} RPC calls.`,
        'Current FDL:',
        input.existingFlow.fdlJson.length > 6000 ? `${input.existingFlow.fdlJson.slice(0, 6000)}\n...[truncated]` : input.existingFlow.fdlJson,
        '',
        'Produce a revision with STRICTLY fewer declared inputs (or fewer RPC calls). If genuinely impossible, call skip.',
      )
    } else {
      userSections.push(
        '',
        'No published flow exists for this program yet. Author one for the single most useful caller-facing instruction, with the smallest possible number of declared inputs.',
      )
    }

    const result = await generateText({
      model,
      system: flowAuthorSystemPrompt(),
      prompt: userSections.join('\n'),
      tools,
      stopWhen: [hasToolCall('finalize_flow'), hasToolCall('skip'), isStepCount(MAX_STEPS)],
      prepareStep: async ({ stepNumber }) => {
        // Last step: force a finalize so the loop can never end empty-handed.
        if (stepNumber >= MAX_STEPS - 1) {
          forcedFinalStep = true
          return { activeTools: ['finalize_flow'], toolChoice: { type: 'tool' as const, toolName: 'finalize_flow' as const } }
        }
        // `toolChoice: 'required'` on every step: ai-sdk ends the loop as soon
        // as a step produces no tool call, and a run died exactly that way —
        // the model finished researching, had nothing it was allowed to call,
        // emitted prose, and the loop stopped at step 4. There is never a
        // legitimate reason to emit bare text here; even finishing is a tool.
        if (stepNumber < RESEARCH_ONLY_STEPS) {
          return { activeTools: [...RESEARCH_TOOLS], toolChoice: 'required' as const }
        }
        // Overlapping window: research stays available so a mid-build lookup is
        // possible, and building unlocks as soon as the model is ready.
        if (stepNumber < RESEARCH_DEADLINE) {
          return { activeTools: [...RESEARCH_TOOLS, ...BUILD_TOOLS], toolChoice: 'required' as const }
        }
        // Deadline passed: withdraw research so the remaining steps go into
        // validate/simulate/finalize. Without this a large program invites
        // endless investigation and the run ends having built nothing.
        return { activeTools: [...BUILD_TOOLS], toolChoice: 'required' as const }
      },
    })

    const usage: Usage = {
      promptTokens: (result.usage as any)?.inputTokens ?? (result.usage as any)?.promptTokens ?? 0,
      completionTokens: (result.usage as any)?.outputTokens ?? (result.usage as any)?.completionTokens ?? 0,
    }
    const transcript = result.steps
      .map((s, i) => `step ${i}: ${s.toolCalls.map((tc) => tc.toolName).join(', ') || '(text)'}`)
      .join('\n')

    if (terminal.skipped) {
      return { kind: 'skip', reason: terminal.skipped.reason, steps: result.steps.length, usage, transcript }
    }
    if (!terminal.finalized) {
      // Belt and braces alongside the forced-finalize step: if the model still
      // produced nothing (provider ignored toolChoice, or emitted unparseable
      // args), fall back to the best draft that actually compiled rather than
      // throwing the whole run away. The workflow re-simulates regardless, so
      // an unsimulated fallback still cannot reach Telegram unverified.
      if (draftState.lastGood) {
        return {
          kind: 'compiled',
          doc: draftState.lastGood.doc,
          plan: draftState.lastGood.plan,
          rationale: `(auto-finalized from last ${draftState.lastGood.simulated ? 'simulated' : 'validated'} draft — model did not call finalize_flow)`,
          steps: result.steps.length,
          usage,
          transcript,
          simulationInputs: draftState.lastGood.simulated ? lastSimInputs : {},
        }
      }
      return { kind: 'no_finalize', steps: result.steps.length, usage, transcript, errors: lastErrors }
    }

    const fdlParsed = FlowDocumentSchema.safeParse(terminal.finalized.fdl)
    if (!fdlParsed.success) {
      return {
        kind: 'no_finalize',
        steps: result.steps.length,
        usage,
        transcript,
        errors: fdlParsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      }
    }
    const compiled = await compile(fdlParsed.data)
    if (!compiled.ok) {
      // A forced finalize can hand back something never validated. Prefer a
      // draft that actually compiled and simulated over the model's last gasp.
      if (draftState.lastGood) {
        return {
          kind: 'compiled',
          doc: draftState.lastGood.doc,
          plan: draftState.lastGood.plan,
          rationale: `(finalized document did not compile — fell back to last ${draftState.lastGood.simulated ? 'simulated' : 'validated'} draft)`,
          steps: result.steps.length,
          usage,
          transcript,
          simulationInputs: draftState.lastGood.simulated ? lastSimInputs : {},
        }
      }
      return {
        kind: 'no_finalize',
        steps: result.steps.length,
        usage,
        transcript,
        errors: compiled.errors.map((e) => `${e.nodeId ?? e.path ?? ''}: ${e.message}`),
      }
    }

    return {
      kind: 'compiled',
      doc: fdlParsed.data,
      plan: compiled.plan,
      rationale: terminal.finalized.rationale,
      steps: result.steps.length,
      usage,
      transcript,
      simulationInputs: compiled.plan.hash === lastSimulatedHash ? lastSimInputs : {},
    }
  }
}
