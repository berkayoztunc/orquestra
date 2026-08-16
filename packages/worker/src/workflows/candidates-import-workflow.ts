import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { processCandidates, type SyncEnv } from '../services/idl-sync'
import { buildMainnetRpcUrlList } from '../utils/solana-rpc'
import { recordWorkflowInstance } from '../services/workflow-registry'
import { generateId } from '../utils/id'
import { hibernateEvery } from '../utils/workflow-helpers'
import { finalizeSyncRunFailed } from '../services/sync-runs'

const TAG = '[candidates-import-workflow]'

/**
 * Candidates per durable step. Each candidate costs ~2-4 subrequests (RPC
 * fetch + ownership check + D1 writes). The Workflows engine can pack
 * several fast consecutive steps into ONE Worker invocation, and the
 * 1000-subrequest limit accumulates across them — so chunks are kept small
 * and a periodic step.sleep forces hibernation (= fresh invocation budget).
 */
const CHUNK = 100

/**
 * Chunks between forced hibernations. Worst-case cost is 4 subrequests/candidate
 * (see comment above) — 3 chunks × 100 = 300 candidates × 4 = 1200, already over
 * the 1000-subrequest budget, which is what actually tripped "Too many API
 * requests by single Worker invocation" on real runs. 2 chunks × 100 × 4 = 800
 * keeps a safety margin even at worst case.
 */
const CHUNKS_PER_BREATHER = 2

/** Chunks per instance (~6k candidates) — keeps step count far below limits. */
const MAX_CHUNKS = 60

/** Safety valve on self-continuation depth (60 × 6k = 360k candidates max). */
const MAX_ROUNDS = 60

type Env = SyncEnv & {
  CANDIDATES_IMPORT_WORKFLOW: any
}

export type CandidatesImportParams = {
  trigger?: string
  /**
   * 'import'     — process pending candidates + due no_idl rechecks (hourly cron)
   * 'full-sweep' — walk the ENTIRE candidate pool ignoring recheck_after
   *                (weekly "all IDL" scan)
   */
  mode?: 'import' | 'full-sweep'
  /** Continuation round (0 = first instance of a run) */
  round?: number
  /** Sweep marker: rows last checked before this ISO timestamp are due */
  sweepStart?: string
}

export class CandidatesImportWorkflow extends WorkflowEntrypoint<Env, CandidatesImportParams> {
  async run(event: WorkflowEvent<CandidatesImportParams>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'cron'
    const mode = event.payload?.mode ?? 'import'
    const round = event.payload?.round ?? 0
    // For full sweeps the marker is fixed on round 0 and carried through
    // continuations, so each row is visited exactly once per sweep.
    const sweepStart =
      mode === 'full-sweep'
        ? event.payload?.sweepStart ?? new Date().toISOString().replace('T', ' ').slice(0, 19)
        : undefined

    console.log(`${TAG} started (trigger=${trigger}, mode=${mode}, round=${round})`)

    const runId = await step.do(
      'init run',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => {
        const runId = generateId()
        await this.env.DB
          .prepare(
            "INSERT INTO sync_runs (id, started_at, trigger, status) VALUES (?, CURRENT_TIMESTAMP, ?, 'running')",
          )
          .bind(runId, mode === 'full-sweep' ? 'full-sweep' : 'import')
          .run()
        return runId
      },
    )

    let checked = 0
    let imported = 0
    let queueEmpty = false

    try {
      for (let i = 0; i < MAX_CHUNKS; i++) {
        const result = await step.do(
          `${mode} chunk ${i + 1} of ${MAX_CHUNKS} (round ${round})`,
          { timeout: '5 minutes', retries: { limit: 2, delay: 15000, backoff: 'exponential' } },
          async () => {
            const rpcUrls = buildMainnetRpcUrlList(this.env)
            const r = await processCandidates(
              this.env.DB,
              rpcUrls,
              this.env.AI,
              Date.now(), // fresh wall clock per step — the step timeout is the limit
              0,
              CHUNK,
              sweepStart ? { sweepBefore: sweepStart } : undefined,
              this.env.HELIUS_API_KEY,
            )
            return { checked: r.checked, imported: r.imported }
          },
        )

        checked += result.checked
        imported += result.imported

        if (result.checked === 0) {
          queueEmpty = true
          break
        }

        // Hibernate periodically so the next chunks get a fresh Worker
        // invocation (resets the per-invocation subrequest counter).
        await hibernateEvery(step, i + 1, CHUNKS_PER_BREATHER, `chunk ${i + 1}`)
      }
    } catch (err) {
      // Best-effort: never leave the sync_runs row stuck at 'running'.
      await step.do(
        'finalize run (failed)',
        { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
        async () => finalizeSyncRunFailed(this.env.DB, runId, {
          total_checked: 0,
          total_programs: 0,
          candidates_checked: checked,
          candidates_imported: imported,
        }),
      )
      throw err
    }

    await step.do(
      'finalize run',
      { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
      async () => {
        await this.env.DB
          .prepare(
            `UPDATE sync_runs
             SET completed_at = CURRENT_TIMESTAMP, status = 'complete',
                 total_checked = 0, total_programs = 0,
                 candidates_checked = ?, candidates_imported = ?
             WHERE id = ?`,
          )
          .bind(checked, imported, runId)
          .run()
      },
    )

    // Self-continue while work remains — each instance stays small and durable.
    if (!queueEmpty && round < MAX_ROUNDS) {
      await step.do(
        'spawn continuation',
        { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
        async () => {
          const params: CandidatesImportParams = {
            trigger: 'continuation',
            mode,
            round: round + 1,
            sweepStart,
          }
          const instance = await this.env.CANDIDATES_IMPORT_WORKFLOW.create({ params })
          await recordWorkflowInstance(this.env.DB, {
            instanceId: instance.id,
            workflow: 'candidates-import',
            trigger: 'continuation',
            params,
          })
          console.log(`${TAG} continuation spawned (round ${round + 1}, instance ${instance.id})`)
        },
      )
    }

    const summary = { runId, mode, round, checked, imported, queueEmpty }
    console.log(`${TAG} complete`, summary)
    return summary
  }
}
