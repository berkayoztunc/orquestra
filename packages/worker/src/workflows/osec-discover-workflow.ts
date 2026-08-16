import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { fetchOsecVerifiedProgramIds } from '../services/osec'
import { LAST_DISCOVERY_KV_KEY } from '../services/pipeline-health'
import { recordWorkflowInstance, hasActiveInstance } from '../services/workflow-registry'
import { checkExistingIds } from '../services/db-batch'
import { enqueueCandidates } from '../services/candidates'
import { sendWorkflowReport } from '../services/telegram'

const TAG = '[osec-discover-workflow]'
const CHECK_BATCH = 100  // max IDs per IN() query
const INSERT_BATCH = 100 // max IDs per INSERT step

type Env = { DB: any; CACHE: any; OSEC_DISCOVER_WORKFLOW: any; TELEGRAM_BOT_TOKEN?: string; TELEGRAM_CHAT_ID?: string }
type Params = { trigger?: 'manual' | 'admin' | 'remediation' }

export class OsecDiscoverWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    const startedAt = Date.now()
    console.log(`${TAG} started (trigger=${trigger}, instance=${event.instanceId})`)

    await step.do(
      'register instance',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => {
        await recordWorkflowInstance(this.env.DB, {
          instanceId: event.instanceId,
          workflow: 'osec-discover',
          trigger,
          params: event.payload,
        })
      },
    )

    // Concurrency guard: the daily schedule fires independently of a manual
    // admin/remediation trigger.
    const shouldAbort = await step.do(
      'check concurrency',
      { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
      async () => hasActiveInstance(this.env.DB, this.env.OSEC_DISCOVER_WORKFLOW, 'osec-discover', 2, event.instanceId),
    )

    if (shouldAbort) {
      console.log(`${TAG} another osec-discover instance is already active — skipping this run`)
      return { skipped: true, reason: 'already-running' }
    }

    try {

    // ── Step 1: fetch all OSEC program IDs ───────────────────────────────────
    const osecIds = await step.do(
      'fetch osec verified list',
      { timeout: '3 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const { programIds } = await fetchOsecVerifiedProgramIds()
        console.log(`${TAG} fetched ${programIds.length} verified program IDs from OSEC`)
        return programIds
      },
    )

    // Health stamp: the pipeline checker treats a missing/old stamp as stale
    // discovery and re-triggers this workflow.
    const stampDiscovery = async () => {
      await step.do(
        'stamp discovery freshness',
        { timeout: '15 seconds', retries: { limit: 2, delay: 3000, backoff: 'exponential' } },
        async () => {
          await this.env.CACHE.put(LAST_DISCOVERY_KV_KEY, new Date().toISOString())
        },
      )
    }

    if (osecIds.length === 0) {
      console.log(`${TAG} empty OSEC list — aborting`)
      const result = { total: 0, alreadyInDb: 0, alreadyQueued: 0, queued: 0 }
      await sendWorkflowReport(this.env, { workflow: 'osec-discover', trigger, instanceId: event.instanceId, startedAt, ok: true, result })
      return result
    }

    await stampDiscovery()

    // ── Step 2: find which IDs are NOT already in projects table ─────────────
    const newIds = await step.do(
      'filter already-imported programs',
      { timeout: '2 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const existingSet = await checkExistingIds(this.env.DB, 'projects', 'program_id', osecIds, CHECK_BATCH)
        const notInDb = osecIds.filter((id) => !existingSet.has(id))
        console.log(`${TAG} ${existingSet.size} already in DB, ${notInDb.length} new`)
        return notInDb
      },
    )

    if (newIds.length === 0) {
      console.log(`${TAG} all OSEC programs already in DB`)
      const result = { total: osecIds.length, alreadyInDb: osecIds.length, alreadyQueued: 0, queued: 0 }
      await sendWorkflowReport(this.env, { workflow: 'osec-discover', trigger, instanceId: event.instanceId, startedAt, ok: true, result })
      return result
    }

    // ── Step 3: find which new IDs are NOT already in program_candidates ──────
    const toEnqueue = await step.do(
      'filter already-queued candidates',
      { timeout: '2 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const queuedSet = await checkExistingIds(this.env.DB, 'program_candidates', 'program_id', newIds, CHECK_BATCH)
        const notQueued = newIds.filter((id) => !queuedSet.has(id))
        console.log(`${TAG} ${queuedSet.size} already queued, ${notQueued.length} to insert`)
        return notQueued
      },
    )

    if (toEnqueue.length === 0) {
      console.log(`${TAG} all new OSEC programs already in candidate queue`)
      const result = {
        total: osecIds.length,
        alreadyInDb: osecIds.length - newIds.length,
        alreadyQueued: newIds.length,
        queued: 0,
      }
      await sendWorkflowReport(this.env, { workflow: 'osec-discover', trigger, instanceId: event.instanceId, startedAt, ok: true, result })
      return result
    }

    // ── Steps 4..N: batch-insert into program_candidates ─────────────────────
    const totalBatches = Math.ceil(toEnqueue.length / INSERT_BATCH)
    let inserted = 0

    for (let i = 0; i < totalBatches; i++) {
      const batch = toEnqueue.slice(i * INSERT_BATCH, (i + 1) * INSERT_BATCH)

      const count = await step.do(
        `enqueue batch ${i + 1} of ${totalBatches}`,
        { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
        async () => {
          const n = await enqueueCandidates(this.env.DB, batch, 'osec')
          console.log(`${TAG} batch ${i + 1}/${totalBatches}: inserted ${n} candidates`)
          return n
        },
      )

      inserted += count
    }

    const result = {
      total: osecIds.length,
      alreadyInDb: osecIds.length - newIds.length,
      alreadyQueued: newIds.length - toEnqueue.length,
      queued: inserted,
    }
    console.log(`${TAG} complete`, result)
    console.log(`${TAG} next: trigger IDL sync workflow to process ${inserted} new candidates`)
    await sendWorkflowReport(this.env, { workflow: 'osec-discover', trigger, instanceId: event.instanceId, startedAt, ok: true, result })
    return result

    } catch (err) {
      await sendWorkflowReport(this.env, {
        workflow: 'osec-discover',
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
