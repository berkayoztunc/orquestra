const COMPASS_BASE = 'https://solanacompass.com/analytics/api/program-metrics'
const PER_PAGE = 1000

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

  const stmt = env.DB.prepare(UPSERT_SQL)

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
        imported++
      } catch (dbErr) {
        console.error(`[program-metrics] insert failed for ${p.program}:`, dbErr)
        throw dbErr
      }
    }

    console.log(`[program-metrics] Page ${page}: inserted ${programs.length} rows (total ${imported})`)

    if (programs.length < PER_PAGE) break
    page++
  }

  console.log(`[program-metrics] Done: ${imported} rows across ${pages} pages`)
  return { imported, pages }
}
