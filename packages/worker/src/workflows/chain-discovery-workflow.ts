import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { getSignaturesSince, getTransaction, extractDeployedProgramId, type SignatureInfo } from '../utils/solana-rpc'
import { buildMainnetRpcUrlList } from '../utils/solana-rpc'
import { recordWorkflowInstance } from '../services/workflow-registry'
import { LAST_CHAIN_DISCOVERY_KV_KEY } from '../services/pipeline-health'
import { generateId } from '../utils/id'

const TAG = '[chain-discovery-workflow]'

/**
 * Incremental replacement for the old daily-scan.yml full getProgramAccounts
 * sweep (500k+ accounts, every day, regardless of new activity). Instead:
 * page getSignaturesForAddress against the BPF Loader Upgradeable program
 * from a saved cursor, fetch only the NEW transactions since last run, and
 * extract newly-deployed program ids from DeployWithMaxDataLen instructions.
 *
 * Legacy loaders (v1/v2) are intentionally excluded — deprecated, frozen,
 * near-zero new-deploy value (the CLI scanner already defaulted v1 off).
 */
const LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111'

const PAGE_LIMIT = 1000
const MAX_PAGES_PER_STEP = 5
/** getTransaction is the real RPC cost — capped independently of signature count. */
const MAX_TX_FETCHES_PER_INSTANCE = 500
const TX_FETCH_BATCH = 25
const CHUNKS_PER_BREATHER = 3
const MAX_ROUNDS = 30

type Env = {
  DB: D1Database
  CACHE: KVNamespace
  CHAIN_DISCOVERY_WORKFLOW: any
  SOLANA_RPC_URL: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
}

type Params = {
  trigger?: 'cron' | 'schedule' | 'admin' | 'remediation' | 'continuation'
  round?: number
  runId?: string
  /** Carried across continuations so a single logical run has one sync_runs row. */
  carriedTxFetched?: number
  carriedQueued?: number
}

export class ChainDiscoveryWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'schedule'
    const round = event.payload?.round ?? 0
    const isContinuation = trigger === 'continuation'
    console.log(`${TAG} started (trigger=${trigger}, round=${round}, instance=${event.instanceId})`)

    const rpcUrls = buildMainnetRpcUrlList(this.env)

    // Self-register immediately so the concurrency check below (and other
    // instances' checks) can see this instance regardless of how it was
    // triggered (workflow-native schedule, admin API, or remediation).
    await step.do(
      'register instance',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => {
        await recordWorkflowInstance(this.env.DB, {
          instanceId: event.instanceId,
          workflow: 'chain-discovery',
          trigger: trigger === 'schedule' ? 'cron' : trigger,
          params: event.payload,
        })
      },
    )

    // Concurrency guard: the schedule fires independently of our own code,
    // so an admin/remediation trigger can land at the same moment. Only
    // fresh starts (not continuations of an already-running logical run)
    // check for and yield to another active instance — avoids duplicate
    // signature/transaction RPC work and a cursor-advance race.
    if (!isContinuation) {
      const shouldAbort = await step.do(
        'check concurrency',
        { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
        async () => {
          const { results } = await this.env.DB
            .prepare(
              `SELECT instance_id FROM workflow_instances
               WHERE workflow = 'chain-discovery' AND instance_id != ?
                 AND created_at > datetime('now', '-2 hours')
               ORDER BY created_at DESC LIMIT 10`,
            )
            .bind(event.instanceId)
            .all<{ instance_id: string }>()

          for (const row of results ?? []) {
            try {
              const instance = await this.env.CHAIN_DISCOVERY_WORKFLOW.get(row.instance_id)
              const { status } = await instance.status()
              if (status === 'running' || status === 'queued' || status === 'paused' || status === 'waiting') {
                return true
              }
            } catch { /* instance gone — ignore */ }
          }
          return false
        },
      )

      if (shouldAbort) {
        console.log(`${TAG} another chain-discovery instance is already active — skipping this run`)
        return { skipped: true, reason: 'already-running' }
      }
    }

    const { runId, cursor } = await step.do(
      'init run',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => {
        let runId = event.payload?.runId
        if (!runId) {
          runId = generateId()
          await this.env.DB
            .prepare("INSERT INTO sync_runs (id, started_at, trigger, status) VALUES (?, CURRENT_TIMESTAMP, 'chain-discovery', 'running')")
            .bind(runId)
            .run()
        }
        const row = await this.env.DB
          .prepare('SELECT last_signature FROM discovery_cursors WHERE loader_address = ?')
          .bind(LOADER)
          .first<{ last_signature: string | null }>()
        return { runId, cursor: row?.last_signature ?? null }
      },
    )

    let queued = 0
    let txFetched = event.payload?.carriedTxFetched ?? 0
    let truncated = false
    let newCursor: string | null = null

    try {
      const { signatures, newCursor: fetchedCursor, truncated: pagesTruncated } = await step.do(
        'fetch new signatures',
        { timeout: '3 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
        async () => {
          const result = await getSignaturesSince(rpcUrls, LOADER, { lastSignature: cursor }, {
            pageLimit: PAGE_LIMIT,
            maxPages: MAX_PAGES_PER_STEP,
          })
          console.log(`${TAG} ${result.signatures.length} new signatures (truncated=${result.truncated})`)
          return result
        },
      )
      newCursor = fetchedCursor
      truncated = pagesTruncated

      // Cap total getTransaction calls this instance — the real cost driver.
      const budget = Math.max(0, MAX_TX_FETCHES_PER_INSTANCE - txFetched)
      const toFetch = signatures.slice(0, budget)
      if (signatures.length > toFetch.length) truncated = true

      const discoveredIds = new Set<string>()

      for (let i = 0; i < toFetch.length; i += TX_FETCH_BATCH) {
        const batch = toFetch.slice(i, i + TX_FETCH_BATCH)
        const batchNum = Math.floor(i / TX_FETCH_BATCH) + 1
        const totalBatches = Math.ceil(toFetch.length / TX_FETCH_BATCH)

        const ids = await step.do(
          `fetch tx batch ${batchNum} of ${totalBatches}`,
          { timeout: '2 minutes', retries: { limit: 2, delay: 10000, backoff: 'exponential' } },
          async () => {
            const found: string[] = []
            const results = await Promise.allSettled(
              batch.map((s: SignatureInfo) => getTransaction(rpcUrls, s.signature)),
            )
            for (const r of results) {
              if (r.status !== 'fulfilled' || !r.value) continue
              const programId = extractDeployedProgramId(r.value, LOADER)
              if (programId) found.push(programId)
            }
            return found
          },
        )
        for (const id of ids) discoveredIds.add(id)
        txFetched += batch.length

        if (batchNum % CHUNKS_PER_BREATHER === 0 && i + TX_FETCH_BATCH < toFetch.length) {
          await step.sleep(`cooldown after tx batch ${batchNum}`, '1 minute')
        }
      }

      if (discoveredIds.size > 0) {
        const ids = [...discoveredIds]
        queued = await step.do(
          'dedupe + insert candidates',
          { timeout: '1 minute', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
          async () => {
            let n = 0
            for (const programId of ids) {
              const result = await this.env.DB
                .prepare(
                  `INSERT OR IGNORE INTO program_candidates (program_id, status, source, added_at)
                   VALUES (?, 'pending', 'chain-discovery', CURRENT_TIMESTAMP)`,
                )
                .bind(programId)
                .run()
              n += result?.meta?.changes ?? 0
            }
            console.log(`${TAG} inserted ${n} new candidates`)
            return n
          },
        )
      }

      // Cursor-advance-last: only after candidates are durably inserted, so a
      // crash mid-run re-scans the same window next time (idempotent via
      // INSERT OR IGNORE) rather than silently skipping a range.
      if (newCursor) {
        await step.do(
          'advance cursor',
          { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
          async () => {
            await this.env.DB
              .prepare(
                `INSERT INTO discovery_cursors (loader_address, last_signature, last_slot, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(loader_address) DO UPDATE SET
                   last_signature = excluded.last_signature,
                   last_slot = excluded.last_slot,
                   updated_at = CURRENT_TIMESTAMP`,
              )
              .bind(LOADER, newCursor, 0)
              .run()
          },
        )
      }
    } catch (err) {
      await step.do(
        'finalize run (failed)',
        { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
        async () => {
          await this.env.DB
            .prepare("UPDATE sync_runs SET completed_at = CURRENT_TIMESTAMP, status = 'failed' WHERE id = ? AND status = 'running'")
            .bind(runId)
            .run()
        },
      )
      throw err
    }

    // Self-continue if more signatures/transactions remain than this instance's budget allowed.
    if (truncated && round < MAX_ROUNDS) {
      await step.do(
        'spawn continuation',
        { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
        async () => {
          const params: Params = {
            trigger: 'continuation',
            round: round + 1,
            runId,
            carriedTxFetched: 0, // fresh budget per instance
            carriedQueued: (event.payload?.carriedQueued ?? 0) + queued,
          }
          const instance = await this.env.CHAIN_DISCOVERY_WORKFLOW.create({ params })
          await recordWorkflowInstance(this.env.DB, {
            instanceId: instance.id,
            workflow: 'chain-discovery',
            trigger: 'continuation',
            params,
          })
          console.log(`${TAG} continuation spawned (round ${round + 1}, instance ${instance.id})`)
        },
      )
      return { runId, round, queued, txFetched, continued: true }
    }

    const totalQueued = (event.payload?.carriedQueued ?? 0) + queued
    await step.do(
      'finalize run',
      { timeout: '15 seconds', retries: { limit: 3, delay: 3000, backoff: 'exponential' } },
      async () => {
        await this.env.DB
          .prepare(
            `UPDATE sync_runs SET
               completed_at = CURRENT_TIMESTAMP, status = 'complete',
               candidates_checked = ?, candidates_imported = ?
             WHERE id = ?`,
          )
          .bind(txFetched, totalQueued, runId)
          .run()
        // Same KV shape the old GitHub Actions scan wrote — zero frontend
        // changes needed. programs_found now means "new deploys processed
        // this run" (small), not the old ~500k full-universe count.
        await this.env.CACHE.put(
          'scan:metadata',
          JSON.stringify({
            programs_found: totalQueued,
            queued: totalQueued,
            skipped: 0,
            scanned_at: new Date().toISOString(),
          }),
          { expirationTtl: 8 * 24 * 60 * 60 },
        )
        await this.env.CACHE.put(LAST_CHAIN_DISCOVERY_KV_KEY, new Date().toISOString())
      },
    )

    const result = { runId, queued: totalQueued, txFetched }
    console.log(`${TAG} complete`, result)
    return result
  }
}
