import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { syncProjectBatch, processCandidates, type SyncEnv } from '../services/idl-sync'
import { buildMainnetRpcUrlList } from '../utils/solana-rpc'
import { recordWorkflowInstance, hasActiveInstance } from '../services/workflow-registry'
import { generateId } from '../utils/id'
import { hibernateEvery } from '../utils/workflow-helpers'
import { finalizeSyncRunFailed } from '../services/sync-runs'
import { sendWorkflowReport } from '../services/telegram'

const TAG = '[idl-sync-workflow]'
const BATCH_SIZE = 20 // matches CONCURRENCY in idl-sync.ts
const CANDIDATES_PER_RUN = 3000

/**
 * Batches per instance — keeps step counts far below the Workflow step limit.
 * Larger registries continue in a fresh instance carrying the same runId.
 */
const MAX_BATCHES_PER_INSTANCE = 400

type Env = {
  DB: any
  IDLS: any
  CACHE: any
  AI?: any
  HELIUS_API_KEY?: string
  IDL_SYNC_WORKFLOW: any
  SOLANA_RPC_URL: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Params = {
  trigger?: 'cron' | 'manual' | 'continuation'
  /** Continuation state: project offset + sync_runs row + accumulated counts */
  startOffset?: number
  runId?: string
  carried?: { updated: number; unchanged: number; skipped: number; errors: number; categorized: number }
}

export class IdlSyncWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'cron'
    const startOffset = event.payload?.startOffset ?? 0
    const isContinuation = trigger === 'continuation'
    const startedAt = Date.now()
    console.log(`${TAG} started (trigger=${trigger}, startOffset=${startOffset}, instance=${event.instanceId})`)

    await step.do(
      'register instance',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => {
        await recordWorkflowInstance(this.env.DB, {
          instanceId: event.instanceId,
          workflow: 'idl-sync',
          trigger: trigger === 'cron' ? 'cron' : trigger,
          params: event.payload,
        })
      },
    )

    // Concurrency guard: the 6h schedule fires independently of a manual
    // POST /sync/trigger — only fresh starts (not continuations) check for
    // and yield to another active full-sweep instance.
    if (!isContinuation) {
      const shouldAbort = await step.do(
        'check concurrency',
        { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
        async () => hasActiveInstance(this.env.DB, this.env.IDL_SYNC_WORKFLOW, 'idl-sync', 2, event.instanceId),
      )

      if (shouldAbort) {
        console.log(`${TAG} another idl-sync instance is already active — skipping this run`)
        return { skipped: true, reason: 'already-running' }
      }
    }

    // ── Step 1: init — count projects, create sync_runs row ──────────────────
    const { runId, total } = await step.do(
      'init sync run',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => {
        const countRow = await this.env.DB
          .prepare(`SELECT COUNT(*) AS total FROM projects WHERE is_public = 1`)
          .first()
        const total = Number((countRow as any)?.total ?? 0)

        // Continuations reuse the original run's sync_runs row
        let runId = event.payload?.runId
        if (!runId) {
          runId = generateId()
          await this.env.DB
            .prepare(`INSERT INTO sync_runs (id, started_at, trigger, status) VALUES (?, CURRENT_TIMESTAMP, ?, 'running')`)
            .bind(runId, trigger === 'continuation' ? 'cron' : trigger)
            .run()
          console.log(`${TAG} sync_runs row created (id=${runId}), ${total} public projects`)
        }
        return { runId, total }
      },
    )

    // ── Steps 2..N: sync batches ─────────────────────────────────────────────
    const remainingBatches = Math.ceil(Math.max(total - startOffset, 0) / BATCH_SIZE)
    const totalBatches = Math.min(remainingBatches, MAX_BATCHES_PER_INSTANCE)
    const carried = event.payload?.carried
    let updated = carried?.updated ?? 0,
      unchanged = carried?.unchanged ?? 0,
      skipped = carried?.skipped ?? 0,
      errors = carried?.errors ?? 0,
      categorized = carried?.categorized ?? 0

    try {

    for (let i = 0; i < totalBatches; i++) {
      const offset = startOffset + i * BATCH_SIZE
      const counts = await step.do(
        `sync batch ${i + 1} of ${totalBatches}`,
        { timeout: '2 minutes', retries: { limit: 2, delay: 10000, backoff: 'exponential' } },
        async () => {
          const { results: projects } = await this.env.DB
            .prepare(`SELECT id, program_id, name FROM projects WHERE is_public = 1 ORDER BY updated_at ASC LIMIT ? OFFSET ?`)
            .bind(BATCH_SIZE, offset)
            .all()

          if (!projects?.length) return { updated: 0, unchanged: 0, skipped: 0, errors: 0, categorized: 0 }

          console.log(`${TAG} batch ${i + 1}/${totalBatches}: syncing ${projects.length} projects (offset ${offset})`)
          const result = await syncProjectBatch(this.env as SyncEnv, projects as any)
          console.log(`${TAG} batch ${i + 1} done: updated=${result.updated} unchanged=${result.unchanged} skipped=${result.skipped} errors=${result.errors}`)
          return result
        },
      )

      updated += counts.updated
      unchanged += counts.unchanged
      skipped += counts.skipped
      errors += counts.errors
      categorized += counts.categorized

      // The engine may pack consecutive fast steps into one Worker invocation,
      // sharing its 1000-subrequest budget — hibernate periodically to reset it.
      await hibernateEvery(step, i + 1, 10, `batch ${i + 1}`)
    }

    console.log(`${TAG} phase 1 complete: updated=${updated} unchanged=${unchanged} skipped=${skipped} errors=${errors} categorized=${categorized}`)

    // ── Continuation: more project batches than fit in this instance ─────────
    const nextOffset = startOffset + totalBatches * BATCH_SIZE
    if (nextOffset < total) {
      await step.do(
        'spawn continuation',
        { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
        async () => {
          const params: Params = {
            trigger: 'continuation',
            startOffset: nextOffset,
            runId,
            carried: { updated, unchanged, skipped, errors, categorized },
          }
          const instance = await this.env.IDL_SYNC_WORKFLOW.create({ params })
          await recordWorkflowInstance(this.env.DB, {
            instanceId: instance.id,
            workflow: 'idl-sync',
            trigger: 'continuation',
            params: { startOffset: nextOffset, runId },
          })
          console.log(`${TAG} continuation spawned at offset ${nextOffset} (instance ${instance.id})`)
        },
      )
      // Candidates + finalize happen on the last leg only.
      return { runId, total, continuedAt: nextOffset }
    }

    // ── Step N+1: process candidates ─────────────────────────────────────────
    const candidates = await step.do(
      'process candidates',
      { timeout: '10 minutes', retries: { limit: 1, delay: 30000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} starting candidate processing (limit=${CANDIDATES_PER_RUN})`)
        const rpcUrls = buildMainnetRpcUrlList(this.env as SyncEnv)
        const result = await processCandidates(
          this.env.DB,
          rpcUrls,
          this.env.AI,
          Date.now(), // fresh wallStart — step timeout handles the limit
          0,
          CANDIDATES_PER_RUN,
          undefined,
          this.env.HELIUS_API_KEY,
        )
        console.log(`${TAG} candidates done: checked=${result.checked} imported=${result.imported}`)
        return result
      },
    )

    // ── Step N+2: finalize sync_runs row ─────────────────────────────────────
    await step.do(
      'finalize sync run',
      { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
      async () => {
        await this.env.DB
          .prepare(`
            UPDATE sync_runs SET
              completed_at = CURRENT_TIMESTAMP,
              status = 'complete',
              total_programs = ?,
              total_checked = ?,
              updated_count = ?,
              unchanged_count = ?,
              skipped_count = ?,
              error_count = ?,
              candidates_checked = ?,
              candidates_imported = ?
            WHERE id = ?
          `)
          .bind(total, total, updated, unchanged, skipped, errors, candidates.checked, candidates.imported, runId)
          .run()
        console.log(`${TAG} sync_runs finalized (runId=${runId})`)
      },
    )

    const result = { runId, total, updated, unchanged, skipped, errors, categorized, candidatesChecked: candidates.checked, candidatesImported: candidates.imported }
    console.log(`${TAG} workflow complete`, result)
    await sendWorkflowReport(this.env, { workflow: 'idl-sync', trigger, instanceId: event.instanceId, startedAt, ok: true, result })
    return result

    } catch (err) {
      // Never leave the sync_runs row stuck at 'running' when the instance
      // errors out — mark it failed with whatever counts we accumulated.
      await step.do(
        'finalize sync run (failed)',
        { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
        async () => finalizeSyncRunFailed(this.env.DB, runId, {
          total_programs: total,
          updated_count: updated,
          unchanged_count: unchanged,
          skipped_count: skipped,
          error_count: errors,
        }, { requireRunning: true }),
      )
      await sendWorkflowReport(this.env, {
        workflow: 'idl-sync',
        trigger,
        instanceId: event.instanceId,
        startedAt,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
