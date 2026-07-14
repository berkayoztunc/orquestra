const COMPASS_BASE = 'https://solanacompass.com/analytics/api/program-metrics'
const PER_PAGE = 1000
// D1 batch() takes an array of prepared statements — each has exactly 9 bind vars.
// Chunk at 100 statements per batch() call to stay well under D1 limits.
const STMTS_PER_BATCH = 100

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

export async function importProgramMetrics(env: { DB: any }): Promise<{ imported: number; pages: number }> {
  let page = 1
  let imported = 0
  let pages = 0

  while (true) {
    const now = new Date()
    const to = now.toISOString()
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const url =
      `${COMPASS_BASE}?range=7d&interval=1d` +
      `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
      `&sortBy=tx_count&sortDir=desc&page=${page}&per_page=${PER_PAGE}`

    let programs: CompassProgram[]
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      if (!res.ok) {
        console.error(`[program-metrics] Compass API page ${page} returned ${res.status}`)
        break
      }
      const json = await res.json() as { programs?: CompassProgram[] }
      programs = json.programs ?? []
    } catch (err) {
      console.error(`[program-metrics] Fetch error page ${page}:`, err)
      break
    }

    pages++
    if (programs.length === 0) break

    const fetchedAt = new Date().toISOString()

    // Build one prepared statement per row — 9 bind vars each, no batch variable limit issue
    const stmts = programs.map((p) => {
      const m = p.metrics ?? {}
      return env.DB.prepare(UPSERT_SQL).bind(
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

    // D1 batch() runs statements atomically; chunk to avoid batch size limits
    for (let i = 0; i < stmts.length; i += STMTS_PER_BATCH) {
      try {
        await env.DB.batch(stmts.slice(i, i + STMTS_PER_BATCH))
        imported += Math.min(STMTS_PER_BATCH, stmts.length - i)
      } catch (dbErr) {
        console.error(`[program-metrics] batch() failed (page ${page}, stmt offset ${i}):`, dbErr)
        throw dbErr
      }
    }

    if (programs.length < PER_PAGE) break
    page++
  }

  console.log(`[program-metrics] Imported ${imported} rows across ${pages} pages`)
  return { imported, pages }
}
