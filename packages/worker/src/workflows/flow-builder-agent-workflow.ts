/**
 * Flow Builder Agent (migration 026) — the first server-side FDL generator.
 * Daily Workflow, modeled directly on `verified-analysis-workflow.ts`: picks
 * verified programs with no published flow (or one it can strictly improve
 * on), drafts an FDL via Workers AI, compiles + simulates it in-process, and
 * — if it's an improvement — proposes it over Telegram for one-tap approve/
 * reject (handled by `routes/telegram-webhook.ts`).
 *
 * Simulation caveat (documented, not hidden — same honesty posture the flow
 * engine design doc takes about simulation elsewhere): the agent has no real
 * wallet to test with, so it simulates against synthetic placeholder inputs
 * (see `buildSyntheticInputs`) purely to exercise the graph structurally —
 * PDA/ATA derivation, instruction assembly, RPC reads, `simulateTransaction`.
 * A structural pass is what gates a Telegram proposal; it is not a guarantee
 * the flow behaves correctly for an arbitrary real wallet — same caveat any
 * `simulate_flow` caller already lives with.
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { registerAllNodes } from '../flow-engine'
import { run } from '../flow-engine/interpreter'
import type { NodeContext } from '../flow-engine/types'
import type { FlowInputSpec } from '../flow-engine/fdl-schema'
import { resolveSolanaRpcUrl, type SolanaRpcEnv } from '../utils/solana-rpc'
import { generateFlow, estimateCost, DEFAULT_FLOW_BUILDER_MODEL } from '../services/flow-builder-generator'
import { classifyParams, recordAttempt, setTelegramMessage } from '../services/flow-builder-log'
import { sendFlowProposal } from '../services/telegram'
import { recordWorkflowInstance } from '../services/workflow-registry'
import { hibernateEvery } from '../utils/workflow-helpers'

registerAllNodes()

const TAG = '[flow-builder-agent]'

/** Candidates processed per daily run — the primary AI-cost/RPC-cost lever. */
export const MAX_ATTEMPTS_PER_RUN = 5

type Env = SolanaRpcEnv & {
  DB: D1Database
  AI: Ai
  CACHE: KVNamespace
  IDLS: KVNamespace
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Params = {
  trigger?: 'cron' | 'manual' | 'admin'
  /** Target one specific program by address instead of the normal priority pick — bypasses the 7-day cooldown too, since an explicit request should always run. */
  programId?: string
}

type CandidateRow = {
  id: string
  name: string
  program_id: string
  version_id: string
  existing_flow_id: string | null
}

/** Known-valid placeholder pubkey (System Program) — never a real user wallet. */
const PLACEHOLDER_PUBKEY = '11111111111111111111111111111111'

function buildSyntheticInputs(inputSpecs: Record<string, FlowInputSpec>): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(inputSpecs)) {
    if (spec.default !== undefined) {
      inputs[key] = spec.default
      continue
    }
    switch (spec.type) {
      case 'pubkey':
        inputs[key] = PLACEHOLDER_PUBKEY
        break
      case 'u64':
      case 'u32':
      case 'u16':
      case 'u8':
      case 'i64':
      case 'i32':
        inputs[key] = 1
        break
      case 'bps':
        inputs[key] = 50
        break
      case 'bool':
        inputs[key] = true
        break
      case 'string':
      default:
        inputs[key] = 'test'
        break
    }
  }
  return inputs
}

/** Best-effort extraction of the target instruction name for the Telegram message. */
function findInstructionName(doc: { nodes: Array<{ type: string; in: Record<string, unknown> }> }): string | undefined {
  for (const node of doc.nodes) {
    if (node.type.startsWith('orquestra.build_instruction')) {
      const instruction = node.in.instruction
      if (typeof instruction === 'string' && !instruction.startsWith('$')) return instruction
    }
  }
  return undefined
}

export class FlowBuilderAgentWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'cron'
    const targetProgramId = event.payload?.programId?.trim() || undefined
    console.log(`${TAG} started (trigger=${trigger}${targetProgramId ? `, programId=${targetProgramId}` : ''})`)

    await step.do('register instance', { timeout: '10 seconds' }, async () => {
      await recordWorkflowInstance(this.env.DB, {
        instanceId: event.instanceId,
        workflow: 'flow-builder-agent',
        trigger: trigger === 'cron' ? 'cron' : trigger,
      })
    })

    const candidates = await step.do(
      'select candidates',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        // Explicit single-program request: bypass the priority pick, the
        // 7-day cooldown, and even is_verified/is_public — a direct ask
        // always runs, same as pointing the CLI at one program.
        if (targetProgramId) {
          const { results } = await this.env.DB.prepare(
            `SELECT p.id, p.name, p.program_id, v.id AS version_id, f.id AS existing_flow_id
             FROM projects p
             JOIN idl_versions v ON v.project_id = p.id
             LEFT JOIN flows f ON f.program_id = p.program_id AND f.status = 'published'
             WHERE p.program_id = ?
             GROUP BY p.id
             LIMIT 1`,
          )
            .bind(targetProgramId)
            .all()
          const list = (results ?? []) as CandidateRow[]
          console.log(`${TAG} ${list.length} candidate(s) for program ${targetProgramId}`)
          return list
        }

        const { results } = await this.env.DB.prepare(
          `SELECT p.id, p.name, p.program_id, v.id AS version_id, f.id AS existing_flow_id
           FROM projects p
           JOIN idl_versions v ON v.project_id = p.id
           LEFT JOIN flows f ON f.program_id = p.program_id AND f.status = 'published'
           LEFT JOIN flow_builder_attempts fba ON fba.program_id = p.program_id
                AND fba.outcome IN ('proposed', 'published')
                AND fba.created_at > datetime('now', '-7 days')
           WHERE p.is_verified = 1 AND p.is_public = 1 AND fba.id IS NULL
           GROUP BY p.id
           ORDER BY (f.id IS NULL) DESC, p.name ASC
           LIMIT ?`,
        )
          .bind(MAX_ATTEMPTS_PER_RUN)
          .all()
        const list = (results ?? []) as CandidateRow[]
        console.log(`${TAG} ${list.length} candidates selected`)
        return list
      },
    )

    if (candidates.length === 0) {
      console.log(`${TAG} nothing to process`)
      return { attempted: 0, proposed: 0, skipped: 0, failed: 0 }
    }

    let proposed = 0
    let skipped = 0
    let failed = 0

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i]

      await step
        .do(
          `build attempt: ${c.name} (${i + 1}/${candidates.length})`,
          { timeout: '3 minutes', retries: { limit: 1, delay: 10000, backoff: 'exponential' } },
          async () => {
            const versionRow = await this.env.DB.prepare(`SELECT idl_json, cpi_md FROM idl_versions WHERE id = ?`)
              .bind(c.version_id)
              .first<{ idl_json: string; cpi_md: string | null }>()
            if (!versionRow) {
              console.error(`${TAG} idl_versions row missing for ${c.name}`)
              failed++
              return
            }

            let existingFlowCtx: { fdlJson: string; inputCount: number; rpcCalls: number | null } | undefined
            let priorFlowId: string | null = null
            if (c.existing_flow_id) {
              const flowRow = await this.env.DB.prepare(
                `SELECT v.content_hash, v.fdl_json, v.metadata_json
                 FROM flows f JOIN flow_versions v ON v.content_hash = f.stable_version_hash
                 WHERE f.id = ?`,
              )
                .bind(c.existing_flow_id)
                .first<{ content_hash: string; fdl_json: string; metadata_json: string }>()
              if (flowRow) {
                priorFlowId = c.existing_flow_id
                const metadata = JSON.parse(flowRow.metadata_json) as { inputs?: Record<string, unknown> }
                const lastRun = await this.env.DB.prepare(
                  `SELECT rpc_calls FROM flow_runs WHERE version_hash = ? AND status = 'ok' ORDER BY created_at DESC LIMIT 1`,
                )
                  .bind(flowRow.content_hash)
                  .first<{ rpc_calls: number | null }>()
                existingFlowCtx = {
                  fdlJson: flowRow.fdl_json,
                  inputCount: Object.keys(metadata.inputs ?? {}).length,
                  rpcCalls: lastRun?.rpc_calls ?? null,
                }
              }
            }

            const reason: 'no_flow' | 'optimization_candidate' = existingFlowCtx ? 'optimization_candidate' : 'no_flow'

            const outcome = await generateFlow({
              ai: this.env.AI,
              ctx: {
                programId: c.program_id,
                projectName: c.name,
                idlJson: versionRow.idl_json,
                cpiMd: versionRow.cpi_md,
                existingFlow: existingFlowCtx,
              },
            })

            const { neurons, usd } = estimateCost(outcome.usage.promptTokens, outcome.usage.completionTokens)
            const baseAttempt = {
              programId: c.program_id,
              projectId: c.id,
              projectName: c.name,
              reason,
              reasonDetail: outcome.kind === 'skip' ? outcome.reason : null,
              priorFlowId,
              priorInputCount: existingFlowCtx?.inputCount ?? null,
              priorRpcCalls: existingFlowCtx?.rpcCalls ?? null,
              model: DEFAULT_FLOW_BUILDER_MODEL,
              promptTokens: outcome.usage.promptTokens,
              completionTokens: outcome.usage.completionTokens,
              neuronsEstimated: neurons,
              usdEstimated: usd,
              attemptRounds: outcome.rounds,
              workflowInstanceId: event.instanceId,
            }

            if (outcome.kind === 'skip') {
              await recordAttempt(this.env.DB, baseAttempt, { outcome: 'skipped_no_improvement' })
              skipped++
              return
            }

            if (outcome.kind === 'compile_failed') {
              await recordAttempt(
                this.env.DB,
                baseAttempt,
                { outcome: 'compile_failed', errorDetail: outcome.errors.join('; ') },
                { rawAiResponse: outcome.lastDraftRaw },
              )
              failed++
              return
            }

            // outcome.kind === 'compiled' — simulate against real RPC.
            const { rpcUrl } = resolveSolanaRpcUrl({ network: 'mainnet-beta', env: this.env })
            const nodeCtx: NodeContext = { db: this.env.DB, cache: this.env.CACHE, idls: this.env.IDLS, rpcUrl }
            const syntheticInputs = buildSyntheticInputs(outcome.plan.inputs)
            const simResult = await run(outcome.plan, syntheticInputs, nodeCtx)

            const newInputCount = Object.keys(outcome.plan.inputs).length
            const newRpcCalls = simResult.rpcCalls

            if (!simResult.ok) {
              await recordAttempt(
                this.env.DB,
                baseAttempt,
                {
                  outcome: 'simulate_failed',
                  fdlContentHash: outcome.plan.hash,
                  newInputCount,
                  newRpcCalls,
                  rationale: outcome.rationale,
                  errorDetail: `${simResult.error.nodeId ?? '(top-level)'}: ${simResult.error.message}`,
                },
                { doc: outcome.doc, plan: outcome.plan, rawAiResponse: outcome.rawResponse },
              )
              failed++
              return
            }

            const isImprovement =
              !existingFlowCtx ||
              newInputCount < existingFlowCtx.inputCount ||
              (existingFlowCtx.rpcCalls != null && newRpcCalls < existingFlowCtx.rpcCalls)

            if (!isImprovement) {
              await recordAttempt(
                this.env.DB,
                baseAttempt,
                {
                  outcome: 'skipped_no_improvement',
                  fdlContentHash: outcome.plan.hash,
                  newInputCount,
                  newRpcCalls,
                  rationale: outcome.rationale,
                },
                { doc: outcome.doc, plan: outcome.plan, rawAiResponse: outcome.rawResponse },
              )
              skipped++
              return
            }

            const attemptId = await recordAttempt(
              this.env.DB,
              baseAttempt,
              {
                outcome: 'proposed',
                fdlContentHash: outcome.plan.hash,
                newInputCount,
                newRpcCalls,
                rationale: outcome.rationale,
              },
              { doc: outcome.doc, plan: outcome.plan, rawAiResponse: outcome.rawResponse },
            )

            const paramCounts = classifyParams(outcome.doc)
            const sent = await sendFlowProposal(this.env, {
              attemptId,
              programId: c.program_id,
              projectName: c.name,
              reason,
              instructionName: findInstructionName(outcome.doc),
              paramCounts: {
                input: paramCounts.input.length,
                resolvable: paramCounts.resolvable.length,
                constant: paramCounts.constant.length,
              },
              newInputCount,
              newRpcCalls,
              priorInputCount: existingFlowCtx?.inputCount ?? null,
              priorRpcCalls: existingFlowCtx?.rpcCalls ?? null,
              simulationSummary: `OK, ${newRpcCalls} RPC calls`,
              model: DEFAULT_FLOW_BUILDER_MODEL,
              neuronsEstimated: neurons,
              usdEstimated: usd,
            })
            if (sent) {
              await setTelegramMessage(this.env.DB, attemptId, sent.messageId, sent.chatId)
            } else {
              console.error(`${TAG} Telegram send failed for attempt ${attemptId} — proposal logged but not delivered`)
            }
            proposed++
          },
        )
        .catch((err) => {
          console.error(`${TAG} attempt failed for ${c.name}:`, err)
          failed++
        })

      await hibernateEvery(step, i + 1, 5, `attempt ${i + 1}`)
    }

    const result = { attempted: candidates.length, proposed, skipped, failed }
    console.log(`${TAG} complete`, result)
    return result
  }
}
