import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { fetchOsecVerifiedProgramIds } from '../services/osec'
import { LAST_DISCOVERY_KV_KEY } from '../services/pipeline-health'
import { recordWorkflowInstance } from '../services/workflow-registry'

const TAG = '[osec-discover-workflow]'
const CHECK_BATCH = 100  // max IDs per IN() query
const INSERT_BATCH = 100 // max IDs per INSERT step

type Env = { DB: any; CACHE: any; OSEC_DISCOVER_WORKFLOW: any }
type Params = { trigger?: 'manual' | 'admin' | 'remediation' }

export class OsecDiscoverWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
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
      async () => {
        const { results } = await this.env.DB
          .prepare(
            `SELECT instance_id FROM workflow_instances
             WHERE workflow = 'osec-discover' AND instance_id != ?
               AND created_at > datetime('now', '-2 hours')
             ORDER BY created_at DESC LIMIT 10`,
          )
          .bind(event.instanceId)
          .all()

        for (const row of (results ?? []) as { instance_id: string }[]) {
          try {
            const instance = await this.env.OSEC_DISCOVER_WORKFLOW.get(row.instance_id)
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
      console.log(`${TAG} another osec-discover instance is already active — skipping this run`)
      return { skipped: true, reason: 'already-running' }
    }

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
      return { total: 0, alreadyInDb: 0, alreadyQueued: 0, queued: 0 }
    }

    await stampDiscovery()

    // ── Step 2: find which IDs are NOT already in projects table ─────────────
    const newIds = await step.do(
      'filter already-imported programs',
      { timeout: '2 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const existingSet = new Set<string>()
        for (let i = 0; i < osecIds.length; i += CHECK_BATCH) {
          const batch = osecIds.slice(i, i + CHECK_BATCH)
          const placeholders = batch.map(() => '?').join(', ')
          const { results } = await this.env.DB
            .prepare(`SELECT program_id FROM projects WHERE program_id IN (${placeholders})`)
            .bind(...batch)
            .all()
          for (const row of (results ?? [])) existingSet.add((row as any).program_id)
        }
        const notInDb = osecIds.filter((id) => !existingSet.has(id))
        console.log(`${TAG} ${existingSet.size} already in DB, ${notInDb.length} new`)
        return notInDb
      },
    )

    if (newIds.length === 0) {
      console.log(`${TAG} all OSEC programs already in DB`)
      return { total: osecIds.length, alreadyInDb: osecIds.length, alreadyQueued: 0, queued: 0 }
    }

    // ── Step 3: find which new IDs are NOT already in program_candidates ──────
    const toEnqueue = await step.do(
      'filter already-queued candidates',
      { timeout: '2 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const queuedSet = new Set<string>()
        for (let i = 0; i < newIds.length; i += CHECK_BATCH) {
          const batch = newIds.slice(i, i + CHECK_BATCH)
          const placeholders = batch.map(() => '?').join(', ')
          const { results } = await this.env.DB
            .prepare(`SELECT program_id FROM program_candidates WHERE program_id IN (${placeholders})`)
            .bind(...batch)
            .all()
          for (const row of (results ?? [])) queuedSet.add((row as any).program_id)
        }
        const notQueued = newIds.filter((id) => !queuedSet.has(id))
        console.log(`${TAG} ${queuedSet.size} already queued, ${notQueued.length} to insert`)
        return notQueued
      },
    )

    if (toEnqueue.length === 0) {
      console.log(`${TAG} all new OSEC programs already in candidate queue`)
      return {
        total: osecIds.length,
        alreadyInDb: osecIds.length - newIds.length,
        alreadyQueued: newIds.length,
        queued: 0,
      }
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
          let n = 0
          for (const programId of batch) {
            const result = await this.env.DB
              .prepare(
                `INSERT OR IGNORE INTO program_candidates (program_id, status, source, added_at)
                 VALUES (?, 'pending', 'osec', CURRENT_TIMESTAMP)`,
              )
              .bind(programId)
              .run()
            n += result?.meta?.changes ?? 0
          }
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
    return result
  }
}
