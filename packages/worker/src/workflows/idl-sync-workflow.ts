import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { syncProjectBatch, processCandidates, type SyncEnv } from '../services/idl-sync'
import { buildMainnetRpcUrlList } from '../utils/solana-rpc'
import { generateId } from '../utils/id'

const TAG = '[idl-sync-workflow]'
const BATCH_SIZE = 20 // matches CONCURRENCY in idl-sync.ts
const CANDIDATES_PER_RUN = 3000

type Env = {
  DB: any
  IDLS: any
  CACHE: any
  AI?: any
  SOLANA_RPC_URL: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
}

type Params = { trigger?: 'cron' | 'manual' }

export class IdlSyncWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'cron'
    console.log(`${TAG} started (trigger=${trigger})`)

    // ── Step 1: init — count projects, create sync_runs row ──────────────────
    const { runId, total } = await step.do(
      'init sync run',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => {
        const countRow = await this.env.DB
          .prepare(`SELECT COUNT(*) AS total FROM projects WHERE is_public = 1`)
          .first()
        const total = Number((countRow as any)?.total ?? 0)

        const runId = generateId()
        await this.env.DB
          .prepare(`INSERT INTO sync_runs (id, started_at, trigger, status) VALUES (?, CURRENT_TIMESTAMP, ?, 'running')`)
          .bind(runId, trigger)
          .run()

        console.log(`${TAG} sync_runs row created (id=${runId}), ${total} public projects`)
        return { runId, total }
      },
    )

    // ── Steps 2..N: sync batches ─────────────────────────────────────────────
    const totalBatches = Math.ceil(total / BATCH_SIZE)
    let updated = 0, unchanged = 0, skipped = 0, errors = 0, categorized = 0

    for (let i = 0; i < totalBatches; i++) {
      const offset = i * BATCH_SIZE
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
    }

    console.log(`${TAG} phase 1 complete: updated=${updated} unchanged=${unchanged} skipped=${skipped} errors=${errors} categorized=${categorized}`)

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
    return result
  }
}
