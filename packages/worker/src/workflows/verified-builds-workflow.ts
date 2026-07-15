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

    // ── Step 1: fetch all OSEC verified program IDs ───────────────────────────
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
          const ids: string[] = (json.verified_programs ?? [])
            .map((p: any) => typeof p === 'string' ? p : (p?.program_id ?? ''))
            .filter((id: string) => id.length > 0)
          return { ids, totalPages: json.meta?.total_pages ?? 1, metaTotal: json.meta?.total ?? 0 }
        }

        const first = await fetchPage(1)
        const allIds: string[] = [...first.ids]

        for (let page = 2; page <= first.totalPages; page++) {
          const { ids } = await fetchPage(page)
          allIds.push(...ids)
          if (ids.length === 0) break
        }

        console.log(`${TAG} fetched ${allIds.length} verified program IDs (meta.total=${first.metaTotal})`)
        return { programIds: allIds, total: allIds.length }
      },
    )

    if (total === 0) {
      console.log(`${TAG} empty OSEC list — aborting to avoid clearing all is_verified flags`)
      return { marked: 0, unmarked: 0, total: 0 }
    }

    // ── Step 2: find programs to unmark (currently verified but dropped off OSEC) ──
    // No global reset — only touch programs that actually changed.
    const toUnmark = await step.do(
      'find programs to unmark',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const { results } = await this.env.DB
          .prepare(`SELECT program_id FROM projects WHERE is_verified = 1`)
          .all()
        const osecSet = new Set(programIds)
        const dropped = (results ?? [])
          .map((r: any) => r.program_id as string)
          .filter((id: string) => !osecSet.has(id))
        console.log(`${TAG} ${(results ?? []).length} currently verified, ${dropped.length} dropped off OSEC list`)
        return dropped
      },
    )

    // ── Step 3: unmark programs that dropped off OSEC list ────────────────────
    let unmarked = 0
    if (toUnmark.length > 0) {
      const unmarkBatches = Math.ceil(toUnmark.length / BATCH_SIZE)
      for (let i = 0; i < unmarkBatches; i++) {
        const batch = toUnmark.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
        const placeholders = batch.map(() => '?').join(', ')

        const count = await step.do(
          `unmark dropped batch ${i + 1} of ${unmarkBatches}`,
          { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
          async () => {
            const result = await this.env.DB
              .prepare(`UPDATE projects SET is_verified = 0, verified_at = NULL WHERE program_id IN (${placeholders})`)
              .bind(...batch)
              .run()
            const n = result?.meta?.changes ?? 0
            console.log(`${TAG} unmark batch ${i + 1}/${unmarkBatches}: cleared ${n} program(s)`)
            return n
          },
        )
        unmarked += count
      }
    }

    // ── Steps 4..N: mark newly verified programs (only where is_verified = 0) ─
    // Skips programs already marked — no unnecessary writes, no blackout window.
    const markBatches = Math.ceil(programIds.length / BATCH_SIZE)
    let marked = 0

    for (let i = 0; i < markBatches; i++) {
      const batch = programIds.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE)
      const placeholders = batch.map(() => '?').join(', ')

      const count = await step.do(
        `mark verified batch ${i + 1} of ${markBatches}`,
        { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
        async () => {
          const result = await this.env.DB
            .prepare(
              `UPDATE projects SET is_verified = 1, verified_at = CURRENT_TIMESTAMP
               WHERE program_id IN (${placeholders}) AND is_verified = 0`,
            )
            .bind(...batch)
            .run()
          const n = result?.meta?.changes ?? 0
          if (n > 0) console.log(`${TAG} mark batch ${i + 1}/${markBatches}: ${n} new program(s) verified`)
          return n
        },
      )
      marked += count
    }

    // ── Final step: trigger analysis for newly verified programs ──────────────
    await step.do(
      'trigger verified analysis',
      { timeout: '30 seconds', retries: { limit: 2, delay: 5000, backoff: 'exponential' } },
      async () => {
        try {
          await this.env.VERIFIED_ANALYSIS_WORKFLOW.create({ params: { trigger: 'cron' } })
          console.log(`${TAG} triggered VerifiedAnalysisWorkflow`)
        } catch (err) {
          console.error(`${TAG} failed to trigger VerifiedAnalysisWorkflow`, err)
        }
      },
    )

    const result = { marked, unmarked, total }
    console.log(`${TAG} complete — ${marked} newly verified, ${unmarked} unmarked, ${total} in OSEC list`)
    return result
  }
}
