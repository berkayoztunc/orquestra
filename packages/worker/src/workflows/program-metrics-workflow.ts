import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'
import { sendWorkflowReport } from '../services/telegram'
import { hibernateEvery } from '../utils/workflow-helpers'

const COMPASS_BASE = 'https://solanacompass.com/analytics/api/program-metrics'
const PER_PAGE = 500
const TAG = '[program-metrics-workflow]'
/**
 * Statements per D1 batch() call — one subrequest per batch instead of one per row.
 * 40, not more: D1 batch() caps total bound variables (~430) and each row binds 9
 * (same limit services/program-metrics.ts already sizes its BATCH_SIZE for).
 */
const D1_BATCH_SIZE = 40
/** Hibernate every N pages so the next pages get a fresh Worker invocation (subrequests accumulate across consecutive steps). */
const PAGES_PER_BREATHER = 15

type Env = {
  DB: any
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}

type Params = Record<string, never>

interface CompassProgram {
  program: string
  metrics: {
    totalTransactions?: number
    uniqueUsers?: number
    totalFees?: number
    totalCompute?: number
  }
  name?: string | null
  labels?: string[]
}

const UPSERT_SQL = `
  INSERT INTO program_metrics
    (program_id, tx_count_7d, unique_users_7d, fees_sol_7d, compute_units_7d,
     compass_name, compass_labels, fetched_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?)
  ON CONFLICT(program_id) DO UPDATE SET
    tx_count_7d      = excluded.tx_count_7d,
    unique_users_7d  = excluded.unique_users_7d,
    fees_sol_7d      = excluded.fees_sol_7d,
    compute_units_7d = excluded.compute_units_7d,
    compass_name     = excluded.compass_name,
    compass_labels   = excluded.compass_labels,
    fetched_at       = excluded.fetched_at,
    updated_at       = excluded.updated_at
`.trim()

export class ProgramMetricsWorkflow extends WorkflowEntrypoint<Env, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const startedAt = Date.now()
    console.log(`${TAG} workflow started`)

    try {

    const fetchedAt = new Date().toISOString()

    // Upserts one page of programs. Rows go through D1 batch() (one subrequest per
    // D1_BATCH_SIZE rows) — a 500-row page written one .run() at a time costs 500
    // subrequests, and Workflows packs consecutive fast steps into one invocation, so
    // two pages would already exceed the 1000-subrequest limit.
    const insertPage = async (programs: CompassProgram[], pageLabel: string): Promise<number> => {
      const stmt = this.env.DB.prepare(UPSERT_SQL)
      const bound = programs.map((p) => {
        const m = p.metrics ?? {}
        return stmt.bind(
          p.program,
          Math.round(m.totalTransactions ?? 0),
          Math.round(m.uniqueUsers ?? 0),
          Number(m.totalFees ?? 0),
          Math.round(m.totalCompute ?? 0),
          p.name ?? null,
          p.labels?.length ? JSON.stringify(p.labels) : null,
          fetchedAt,
          fetchedAt,
        )
      })

      let inserted = 0
      for (let i = 0; i < bound.length; i += D1_BATCH_SIZE) {
        const chunk = bound.slice(i, i + D1_BATCH_SIZE)
        try {
          await this.env.DB.batch(chunk)
          inserted += chunk.length
        } catch (dbErr) {
          console.error(`${TAG} DB batch insert failed (${pageLabel}, rows ${i}-${i + chunk.length - 1}):`, dbErr)
          throw dbErr
        }
      }
      console.log(`${TAG} ${pageLabel}: inserted ${inserted}/${programs.length} rows`)
      return inserted
    }

    // Step 1: fetch + insert page 1, and discover totalPages (API caps per_page at 500).
    // Fetch, parse, and insert happen inside a single step so only small scalars
    // (not the full programs array) cross the step-output boundary — Workflows
    // caps a step's return value at 1MiB, and 500 programs' worth of metrics exceeds that.
    const { totalPages, imported: page1Imported } = await step.do(
      'discover pages and import page 1',
      { timeout: '3 minutes', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
      async () => {
        const url = `${COMPASS_BASE}?range=7d&sortBy=tx_count&sortDir=desc&page=1&per_page=${PER_PAGE}`
        console.log(`${TAG} fetching page 1 (per_page=${PER_PAGE})`)
        const res = await fetch(url, { headers: { Accept: 'application/json' } })
        if (!res.ok) throw new Error(`Compass API returned ${res.status} on discovery`)
        const json = await res.json() as any
        const totalPages = Math.max(1, Number(json.totalPages ?? json.total_pages ?? 1))
        const totalPrograms = Number(json.totalPrograms ?? json.total_programs ?? 0)
        const programs: CompassProgram[] = json.programs ?? []
        console.log(`${TAG} page 1: ${programs.length} programs, totalPages=${totalPages}, totalPrograms=${totalPrograms}`)
        const imported = await insertPage(programs, `page 1/${totalPages}`)
        return { totalPages, imported }
      },
    )

    let imported = page1Imported

    // Steps for pages 2..N
    for (let page = 2; page <= totalPages; page++) {
      const count = await step.do(
        `import page ${page} of ${totalPages}`,
        { timeout: '3 minutes', retries: { limit: 3, delay: 10000, backoff: 'exponential' } },
        async () => {
          const url = `${COMPASS_BASE}?range=7d&sortBy=tx_count&sortDir=desc&page=${page}&per_page=${PER_PAGE}`
          console.log(`${TAG} fetching page ${page}/${totalPages}`)
          const res = await fetch(url, { headers: { Accept: 'application/json' } })
          if (!res.ok) throw new Error(`Compass API page ${page} returned ${res.status}`)
          const json = await res.json() as any
          const programs: CompassProgram[] = json.programs ?? []
          if (programs.length === 0) {
            console.log(`${TAG} page ${page}: empty — stopping early`)
            return 0
          }
          return insertPage(programs, `page ${page}/${totalPages}`)
        },
      )

      imported += count
      console.log(`${TAG} progress: ${imported} total rows (page ${page}/${totalPages} done)`)
      if (count === 0) break

      await hibernateEvery(step, page, PAGES_PER_BREATHER, `page ${page}`, { guard: page < totalPages })
    }

    console.log(`${TAG} workflow complete — ${imported} rows across ${totalPages} pages`)
    const result = { imported, pages: totalPages }
    await sendWorkflowReport(this.env, { workflow: 'program-metrics-import', trigger: 'cron', instanceId: event.instanceId, startedAt, ok: true, result })
    return result

    } catch (err) {
      await sendWorkflowReport(this.env, {
        workflow: 'program-metrics-import',
        trigger: 'cron',
        instanceId: event.instanceId,
        startedAt,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
