import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'

const OSEC_URL = 'https://verify.osec.io/verified-programs'
const TAG = '[verified-builds-workflow]'
const BATCH_SIZE = 100

type Env = { DB: any }
type Params = { trigger?: 'cron' | 'manual' }

export class VerifiedBuildsWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'cron'
    console.log(`${TAG} started (trigger=${trigger})`)

    // ── Step 1: fetch OSEC verified programs list ─────────────────────────────
    const { programIds, total } = await step.do(
      'fetch osec verified list',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        console.log(`${TAG} fetching ${OSEC_URL}`)
        const res = await fetch(OSEC_URL, { headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error(`OSEC API returned ${res.status}`)
        const json = await res.json() as any
        const list: string[] = (json.verified_programs ?? [])
          .map((p: any) => p.program_id as string)
          .filter(Boolean)
        console.log(`${TAG} fetched ${list.length} verified programs (meta.total=${json.meta?.total ?? '?'})`)
        return { programIds: list, total: list.length }
      },
    )

    if (total === 0) {
      console.log(`${TAG} empty list — aborting to avoid wiping all is_verified flags`)
      return { updated: 0, cleared: 0, total: 0 }
    }

    // ── Step 2: clear all existing verified flags ──────────────────────────────
    const cleared = await step.do(
      'reset verified flags',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const result = await this.env.DB
          .prepare(`UPDATE projects SET is_verified = 0, verified_at = NULL WHERE is_verified = 1`)
          .run()
        const n = result?.meta?.changes ?? 0
        console.log(`${TAG} cleared is_verified on ${n} project(s)`)
        return n
      },
    )

    // ── Steps 3..N: batch mark verified programs ───────────────────────────────
    const totalBatches = Math.ceil(programIds.length / BATCH_SIZE)
    let updated = 0

    for (let i = 0; i < totalBatches; i++) {
      const batch = programIds.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
      const placeholders = batch.map(() => '?').join(', ')

      const count = await step.do(
        `mark verified batch ${i + 1} of ${totalBatches}`,
        { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
        async () => {
          const result = await this.env.DB
            .prepare(
              `UPDATE projects SET is_verified = 1, verified_at = CURRENT_TIMESTAMP
               WHERE program_id IN (${placeholders})`,
            )
            .bind(...batch)
            .run()
          const n = result?.meta?.changes ?? 0
          console.log(`${TAG} batch ${i + 1}/${totalBatches}: marked ${n} project(s) verified`)
          return n
        },
      )

      updated += count
    }

    const result = { updated, cleared, total }
    console.log(`${TAG} complete — ${updated} programs marked verified (${cleared} cleared, ${total} in OSEC list)`)
    return result
  }
}
