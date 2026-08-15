/**
 * Flow Builder Agent (migration 026) — the first server-side FDL generator.
 * Daily Workflow, modeled directly on `verified-analysis-workflow.ts`: picks
 * verified programs with no published flow (or one it can strictly improve
 * on), drafts an FDL via Workers AI, compiles + simulates it in-process, and
 * — if it's an improvement — proposes it over Telegram for one-tap approve/
 * reject (handled by `routes/telegram-webhook.ts`).
 *
 * Simulation caveat (documented, not hidden — same honesty posture the flow
 * engine design doc takes about simulation elsewhere): simulation uses a real
 * funded mainnet wallet plus any real account addresses the agent discovered
 * (`find_real_account`), and re-uses those exact inputs here and again at
 * Telegram approval so all three checks test the same scenario. A pass proves
 * the graph resolves, builds and simulates for THOSE inputs; it is not a
 * guarantee for an arbitrary caller — the same caveat any `simulate_flow`
 * caller already lives with.
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { getAgentByName } from 'agents'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'

import { registerAllNodes } from '../flow-engine'
import { run } from '../flow-engine/interpreter'
import type { NodeContext } from '../flow-engine/types'
import { buildSyntheticInputs } from '../services/flow-simulation-inputs'
import { resolveSolanaRpcUrl, type SolanaRpcEnv } from '../utils/solana-rpc'
import { estimateCost } from '../services/flow-builder-cost'
import { FLOW_AUTHOR_MODEL, type FlowAuthorAgent, type DraftFlowOutcome } from '../agents/flow-author-agent'
import { classifyParams, recordAttempt, setTelegramMessage } from '../services/flow-builder-log'
import { sendFlowProposal, sendInstructionChoices, sendText } from '../services/telegram'
import { triageInstructions } from '../services/flow-triage'
import { fetchIDL } from '../services/idl-fetch'
import { generateId } from '../utils/id'
import { recordWorkflowInstance } from '../services/workflow-registry'
import { hibernateEvery } from '../utils/workflow-helpers'

registerAllNodes()

const TAG = '[flow-builder-agent]'

/**
 * Candidates processed per daily run — the primary AI-cost lever.
 * Lowered 5 → 3 alongside the switch to a frontier model: a measured run cost
 * $0.25, so 5/day was ~$38/month. Raise it again once the logged
 * `usd_estimated` values confirm the per-attempt cost after the tool-output
 * caps, rather than guessing.
 */
export const MAX_ATTEMPTS_PER_RUN = 3

type Env = SolanaRpcEnv & {
  DB: D1Database
  AI: Ai
  CACHE: KVNamespace
  IDLS: KVNamespace
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
  FLOW_AUTHOR_AGENT: DurableObjectNamespace<FlowAuthorAgent>
}

type Params = {
  trigger?: 'cron' | 'manual' | 'admin'
  /** Target one specific program by address instead of the normal priority pick — bypasses the 7-day cooldown too, since an explicit request should always run. */
  programId?: string
  /**
   * 'triage' shortlists the instructions worth a flow and asks the operator to
   * pick (cheap, no authoring). 'build' authors one flow. Authoring only ever
   * happens after an explicit pick, so spend is always operator-approved.
   */
  mode?: 'triage' | 'build'
  /** The instruction the operator chose, for mode='build'. */
  instruction?: string
}

type CandidateRow = {
  id: string
  name: string
  program_id: string
  version_id: string
  existing_flow_id: string | null
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

    // ── Triage mode: shortlist instructions and ask, spend nothing on authoring ──
    if (event.payload?.mode === 'triage' && targetProgramId) {
      return await step.do(
        'triage instructions',
        { timeout: '2 minutes', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
        async () => {
          const row = await this.env.DB.prepare(
            `SELECT p.id, p.name FROM projects p WHERE p.program_id = ? LIMIT 1`,
          )
            .bind(targetProgramId)
            .first<{ id: string; name: string }>()
          if (!row) {
            await sendText(this.env, this.env.TELEGRAM_CHAT_ID ?? '', `No indexed project for ${targetProgramId}`)
            return { triaged: 0 }
          }
          const data = await fetchIDL(row.id, this.env)
          if (!data) {
            await sendText(this.env, this.env.TELEGRAM_CHAT_ID ?? '', `No IDL available for ${row.name}`)
            return { triaged: 0 }
          }

          const choices = await triageInstructions(this.env.AI, data.idl, row.name)
          if (choices.length === 0) {
            await sendText(this.env, this.env.TELEGRAM_CHAT_ID ?? '', `No caller-facing instructions found for ${row.name}`)
            return { triaged: 0 }
          }

          // Short id because Telegram caps callback_data at 64 bytes and a
          // program address alone is 44. KV, not D1: this is a scratch
          // shortlist that expires, not a record worth keeping.
          const triageId = generateId().replace(/-/g, '').slice(0, 8)
          await this.env.CACHE.put(
            `triage:${triageId}`,
            JSON.stringify({ programId: targetProgramId, projectId: row.id, projectName: row.name, choices }),
            { expirationTtl: 86_400 },
          )
          await sendInstructionChoices(this.env, {
            triageId,
            projectName: row.name,
            programId: targetProgramId,
            choices,
          })
          console.log(`${TAG} triaged ${choices.length} instruction(s) for ${row.name}`)
          return { triaged: choices.length }
        },
      )
    }

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
          // 10 minutes, not 3: a full agentic loop is up to MAX_STEPS frontier-model
          // calls plus real RPC simulations between them, and a real run measured
          // ~3.5 minutes. The old 3-minute budget was sized for the single-shot
          // generator this replaced and would cut off otherwise-healthy runs.
          { timeout: '10 minutes', retries: { limit: 1, delay: 10000, backoff: 'exponential' } },
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

            // The agentic loop (search catalog, validate, simulate, iterate) —
            // one Durable Object instance per program, real Cloudflare Agents
            // SDK tool-calling via ai-sdk's stopWhen/hasToolCall, not a
            // fixed generate→repair sequence.
            // Cast through `any` on the RPC call itself — the DO stub's
            // structural RPC typing over a discriminated-union return blows
            // past TS's instantiation-depth limit (TS2589); the real
            // `DraftFlowOutcome` type from flow-author-agent.ts is restored
            // immediately below.
            const authorAgent = (await getAgentByName(this.env.FLOW_AUTHOR_AGENT, c.program_id)) as any
            const outcome: DraftFlowOutcome = await authorAgent.draftFlow({
              // projectId is REQUIRED — `orquestra.build_instruction@1` takes a
              // project UUID, not a program address. Without it the agent has
              // to guess and can never emit a valid build node.
              projectId: c.id,
              programId: c.program_id,
              projectName: c.name,
              targetInstruction: event.payload?.instruction,
              cpiMd: versionRow.cpi_md,
              existingFlow: existingFlowCtx,
            })

            const { neurons, usd } = estimateCost(FLOW_AUTHOR_MODEL, outcome.usage.promptTokens, outcome.usage.completionTokens)
            const baseAttempt = {
              programId: c.program_id,
              projectId: c.id,
              projectName: c.name,
              reason,
              reasonDetail: outcome.kind === 'skip' ? outcome.reason : null,
              priorFlowId,
              priorInputCount: existingFlowCtx?.inputCount ?? null,
              priorRpcCalls: existingFlowCtx?.rpcCalls ?? null,
              model: FLOW_AUTHOR_MODEL,
              promptTokens: outcome.usage.promptTokens,
              completionTokens: outcome.usage.completionTokens,
              neuronsEstimated: neurons,
              usdEstimated: usd,
              attemptRounds: outcome.steps,
              workflowInstanceId: event.instanceId,
            }

            if (outcome.kind === 'skip') {
              await recordAttempt(this.env.DB, baseAttempt, { outcome: 'skipped_no_improvement' }, { rawAiResponse: outcome.transcript })
              skipped++
              return
            }

            if (outcome.kind === 'no_finalize') {
              await recordAttempt(
                this.env.DB,
                baseAttempt,
                {
                  outcome: 'compile_failed',
                  errorDetail: outcome.errors?.length
                    ? `finalized FDL did not compile: ${outcome.errors.join('; ')}`
                    : `agent did not finalize within ${outcome.steps} steps`,
                },
                { rawAiResponse: outcome.transcript },
              )
              failed++
              return
            }

            // outcome.kind === 'compiled' — simulate against real RPC.
            const { rpcUrl } = resolveSolanaRpcUrl({ network: 'mainnet-beta', env: this.env })
            const nodeCtx: NodeContext = { db: this.env.DB, cache: this.env.CACHE, idls: this.env.IDLS, rpcUrl }
            // Reuse the exact inputs the agent proved the flow with — it may
            // have discovered a real pool/market address that a placeholder
            // wallet could never stand in for.
            const simInputs = { ...buildSyntheticInputs(outcome.plan.inputs), ...outcome.simulationInputs }
            const simResult = await run(outcome.plan, simInputs, nodeCtx)

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
                { doc: outcome.doc, plan: outcome.plan, rawAiResponse: outcome.transcript, simulationInputs: simInputs },
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
                { doc: outcome.doc, plan: outcome.plan, rawAiResponse: outcome.transcript, simulationInputs: simInputs },
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
              { doc: outcome.doc, plan: outcome.plan, rawAiResponse: outcome.transcript, simulationInputs: simInputs },
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
              model: FLOW_AUTHOR_MODEL,
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
