import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'

const OSEC_URL = 'https://verify.osec.io/verified-programs'
const TAG = '[osec-discover-workflow]'
const CHECK_BATCH = 100  // max IDs per IN() query
const INSERT_BATCH = 100 // max IDs per INSERT step

type Env = { DB: any }
type Params = { trigger?: 'manual' | 'admin' }

export class OsecDiscoverWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'manual'
    console.log(`${TAG} started (trigger=${trigger})`)

    // ── Step 1: fetch all OSEC program IDs ───────────────────────────────────
    const osecIds = await step.do(
      'fetch osec verified list',
      { timeout: '3 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const fetchPage = async (page: number): Promise<{ ids: string[]; totalPages: number }> => {
          const res = await fetch(`${OSEC_URL}?page=${page}`, { headers: { Accept: 'application/json' } })
          if (!res.ok) throw new Error(`OSEC API ${res.status} on page ${page}`)
          const json = await res.json() as any
          const ids: string[] = (json.verified_programs ?? [])
            .map((p: any) => typeof p === 'string' ? p : (p?.program_id ?? ''))
            .filter((id: string) => id.length > 0)
          return { ids, totalPages: json.meta?.total_pages ?? 1 }
        }

        const first = await fetchPage(1)
        const all: string[] = [...first.ids]

        for (let page = 2; page <= first.totalPages; page++) {
          const { ids } = await fetchPage(page)
          if (ids.length === 0) break
          all.push(...ids)
        }

        console.log(`${TAG} fetched ${all.length} verified program IDs from OSEC`)
        return all
      },
    )

    if (osecIds.length === 0) {
      console.log(`${TAG} empty OSEC list — aborting`)
      return { total: 0, alreadyInDb: 0, alreadyQueued: 0, queued: 0 }
    }

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
