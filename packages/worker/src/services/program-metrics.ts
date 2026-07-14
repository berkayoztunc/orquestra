const COMPASS_BASE = 'https://solanacompass.com/analytics/api/program-metrics'
const PER_PAGE = 1000
// 9 bind vars per row × 50 rows = 450, under D1's real variable limit (~500)
const ROWS_PER_BATCH = 50

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

    for (let i = 0; i < programs.length; i += ROWS_PER_BATCH) {
      const slice = programs.slice(i, i + ROWS_PER_BATCH)
      const placeholders = slice.map(() => '(?,?,?,?,?,?,?,?,?)').join(',')
      const values: (string | number | null)[] = []

      for (const p of slice) {
        const m = p.metrics ?? {}
        values.push(
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
      }

      try {
        await env.DB
          .prepare(
            `INSERT INTO program_metrics
               (program_id, tx_count_7d, unique_users_7d, fees_sol_7d, compute_units_7d,
                compass_name, compass_labels, fetched_at, updated_at)
             VALUES ${placeholders}
             ON CONFLICT(program_id) DO UPDATE SET
               tx_count_7d      = excluded.tx_count_7d,
               unique_users_7d  = excluded.unique_users_7d,
               fees_sol_7d      = excluded.fees_sol_7d,
               compute_units_7d = excluded.compute_units_7d,
               compass_name     = excluded.compass_name,
               compass_labels   = excluded.compass_labels,
               fetched_at       = excluded.fetched_at,
               updated_at       = excluded.updated_at`,
          )
          .bind(...values)
          .run()
        imported += slice.length
      } catch (dbErr) {
        console.error(`[program-metrics] DB insert failed (page ${page}, batch offset ${i}):`, dbErr)
        throw dbErr
      }
    }

    if (programs.length < PER_PAGE) break
    page++
  }

  console.log(`[program-metrics] Imported ${imported} rows across ${pages} pages`)
  return { imported, pages }
}
