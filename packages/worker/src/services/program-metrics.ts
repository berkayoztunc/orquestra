import { fetchWithTimeout } from '../utils/solana-rpc'

const COMPASS_BASE = 'https://solanacompass.com/analytics/api/program-metrics'
const PER_PAGE = 500  // Compass API hard cap per page
const BATCH_SIZE = 40 // D1 batch() limit: ~430 vars total; 9 vars/row → max 47, use 40

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

  const fetchedAt = new Date().toISOString()

  while (true) {
    const url =
      `${COMPASS_BASE}?range=7d&sortBy=tx_count&sortDir=desc&page=${page}&per_page=${PER_PAGE}`

    let programs: CompassProgram[]
    try {
      const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } })
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

    for (let i = 0; i < programs.length; i += BATCH_SIZE) {
      const slice = programs.slice(i, i + BATCH_SIZE)
      const stmts = slice.map((p) => {
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
      try {
        await env.DB.batch(stmts)
        imported += slice.length
      } catch (dbErr) {
        console.error(`[program-metrics] batch failed (page ${page}, offset ${i}):`, dbErr)
        throw dbErr
      }
    }

    console.log(`[program-metrics] Page ${page}: ${programs.length} rows (total ${imported})`)

    if (programs.length < PER_PAGE) break
    page++
  }

  console.log(`[program-metrics] Done: ${imported} rows across ${pages} pages`)
  return { imported, pages }
}
