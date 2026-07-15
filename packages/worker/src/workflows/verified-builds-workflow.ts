import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'

const OSEC_URL = 'https://verify.osec.io/verified-programs'
const TAG = '[verified-builds-workflow]'
const BATCH_SIZE = 100

type Env = { DB: any; VERIFIED_ANALYSIS_WORKFLOW: any }
type Params = { trigger?: 'cron' | 'manual' }

export class VerifiedBuildsWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const trigger = event.payload?.trigger ?? 'cron'
    console.log(`${TAG} started (trigger=${trigger})`)

    // ── Step 1: fetch OSEC verified programs list (paginated) ────────────────
    // API returns plain string arrays, 20 per page
    const { programIds, total } = await step.do(
      'fetch osec verified list',
      { timeout: '3 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const fetchPage = async (page: number): Promise<{ ids: string[]; totalPages: number; metaTotal: number }> => {
          const url = `${OSEC_URL}?page=${page}`
          console.log(`${TAG} fetching ${url}`)
          const res = await fetch(url, { headers: { Accept: 'application/json' } })
          if (!res.ok) throw new Error(`OSEC API returned ${res.status} on page ${page}`)
          const json = await res.json() as any
          const ids: string[] = (json.verified_programs ?? []).filter((p: any) => typeof p === 'string' && p.length > 0)
          return { ids, totalPages: json.meta?.total_pages ?? 1, metaTotal: json.meta?.total ?? 0 }
        }

        const first = await fetchPage(1)
        const allIds: string[] = [...first.ids]

        for (let page = 2; page <= first.totalPages; page++) {
          const { ids } = await fetchPage(page)
          allIds.push(...ids)
          if (ids.length === 0) break
        }

        console.log(`${TAG} fetched ${allIds.length} verified programs across ${first.totalPages} pages (meta.total=${first.metaTotal})`)
        return { programIds: allIds, total: allIds.length }
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

    // ── Final step: trigger analysis workflow for newly verified programs ─────
    await step.do(
      'trigger verified analysis',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        try {
          await this.env.VERIFIED_ANALYSIS_WORKFLOW.create({ params: { trigger: 'cron', force: false } })
          console.log(`${TAG} triggered VerifiedAnalysisWorkflow (force=false — new programs only)`)
        } catch (err) {
          console.error(`${TAG} failed to trigger VerifiedAnalysisWorkflow`, err)
        }
      },
    )

    const result = { updated, cleared, total }
    console.log(`${TAG} complete — ${updated} programs marked verified (${cleared} cleared, ${total} in OSEC list)`)
    return result
  }
}
