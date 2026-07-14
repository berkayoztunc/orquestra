import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'

const COMPASS_BASE = 'https://solanacompass.com/analytics/api/program-metrics'
const PER_PAGE = 500
const TAG = '[program-metrics-workflow]'

type Env = {
  DB: any
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
  async run(_event: WorkflowEvent<Params>, step: WorkflowStep) {
    console.log(`${TAG} workflow started`)

    const fetchedAt = new Date().toISOString()

    // Step 1: fetch page 1 to discover totalPages (API caps per_page at 500)
    const { totalPages, firstPagePrograms } = await step.do(
      'discover pages',
      { timeout: '30 seconds', retries: { limit: 3, delay: 5000, backoff: 'exponential' } },
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
        return { totalPages, firstPagePrograms: programs }
      },
    )

    // Insert page 1 data immediately
    const insertPage = async (programs: CompassProgram[], pageLabel: string): Promise<number> => {
      const stmt = this.env.DB.prepare(UPSERT_SQL)
      let inserted = 0
      for (const p of programs) {
        const m = p.metrics ?? {}
        try {
          await stmt.bind(
            p.program,
            Math.round(m.totalTransactions ?? 0),
            Math.round(m.uniqueUsers ?? 0),
            Number(m.totalFees ?? 0),
            Math.round(m.totalCompute ?? 0),
            p.name ?? null,
            p.labels?.length ? JSON.stringify(p.labels) : null,
            fetchedAt,
            fetchedAt,
          ).run()
          inserted++
        } catch (dbErr) {
          console.error(`${TAG} DB insert failed (${pageLabel}) for ${p.program}:`, dbErr)
          throw dbErr
        }
      }
      console.log(`${TAG} ${pageLabel}: inserted ${inserted}/${programs.length} rows`)
      return inserted
    }

    let imported = await step.do(
      `insert page 1 of ${totalPages}`,
      { timeout: '3 minutes', retries: { limit: 2, delay: 10000, backoff: 'exponential' } },
      () => insertPage(firstPagePrograms, `page 1/${totalPages}`),
    )

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
    }

    console.log(`${TAG} workflow complete — ${imported} rows across ${totalPages} pages`)
    return { imported, pages: totalPages }
  }
}
