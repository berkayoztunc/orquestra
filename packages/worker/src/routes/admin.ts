import { Hono } from 'hono'
import { ingestKeyMiddleware } from '../middleware/auth'
import { runDailyIdlSync } from '../services/idl-sync'
import { importProgramMetrics } from '../services/program-metrics'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    AI: Ai
    CACHE: any
    IDLS: any
    API_BASE_URL: string
    INGEST_API_KEY: string
    SOLANA_RPC_URL: string
    SOLANA_MAINNET_RPC_URL?: string
    PROGRAM_METRICS_WORKFLOW: any
    AI_ANALYSIS_WORKFLOW: any
    IDL_SYNC_WORKFLOW: any
    IDL_UPDATE_CACHE_WORKFLOW: any
    BULK_RECATEGORIZE_WORKFLOW: any
  }
}

const app = new Hono<Env>()

// ── Analytics ─────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/analytics
 *
 * Returns last-30-day daily breakdowns for API and MCP traffic, plus the
 * top 20 most-accessed programs. Public endpoint.
 *
 * tool_id values: -1=api, 0=search_programs, 1=list_instructions,
 *   2=build_instruction, 3=list_pda_accounts, 4=derive_pda,
 *   5=read_llms_txt, 6=get_ai_analysis, 7=fetch_pda_data,
 *   8=simulate_instruction, 9=get_program_data
 */
app.get('/analytics', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database not available' }, 500)

  try {
    const [dailyApi, dailyMcp, topPrograms] = await Promise.all([
      // Daily HTTP API totals (last 30 days)
      db
        .prepare(
          `SELECT date, SUM(count) AS total
           FROM analytics
           WHERE event_type = 0
             AND date >= CAST(strftime('%Y%m%d', 'now', '-30 days') AS INTEGER)
           GROUP BY date
           ORDER BY date ASC`,
        )
        .all(),

      // Daily MCP totals per tool (last 30 days)
      db
        .prepare(
          `SELECT date, tool_id, SUM(count) AS total
           FROM analytics
           WHERE event_type = 1
             AND date >= CAST(strftime('%Y%m%d', 'now', '-30 days') AS INTEGER)
           GROUP BY date, tool_id
           ORDER BY date ASC`,
        )
        .all(),

      // Top 20 programs by combined API + MCP request count (all time)
      db
        .prepare(
          `SELECT a.project_id, p.name, SUM(a.count) AS total
           FROM analytics a
           LEFT JOIN projects p ON p.id = a.project_id
           WHERE a.project_id != ''
           GROUP BY a.project_id
           ORDER BY total DESC
           LIMIT 20`,
        )
        .all(),
    ])

    return c.json({
      daily_api: dailyApi.results ?? [],
      daily_mcp: dailyMcp.results ?? [],
      top_programs: topPrograms.results ?? [],
    })
  } catch {
    return c.json({ error: 'Failed to fetch analytics' }, 500)
  }
})

/**
 * POST /api/admin/recategorize
 *
 * Triggers BulkRecategorizeWorkflow — durably categorizes all uncategorized
 * public projects in batches of 25. Returns workflow instanceId for polling.
 * Auth: X-Ingest-Key header required.
 */
app.post('/recategorize', ingestKeyMiddleware, async (c) => {
  const workflow = c.env?.BULK_RECATEGORIZE_WORKFLOW
  if (!workflow) return c.json({ error: 'BULK_RECATEGORIZE_WORKFLOW binding not available' }, 500)

  try {
    const instance = await workflow.create({ params: { trigger: 'admin' } })
    return c.json({ triggered: true, instanceId: instance.id, message: 'BulkRecategorizeWorkflow started' })
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err) }, 500)
  }
})

// ── AI Analysis Workflow ──────────────────────────────────────────────────────

/**
 * POST /api/admin/regenerate-analysis/:projectId
 *
 * Triggers the AI analysis Cloudflare Workflow for a project.
 * Steps: fetch project → generate docs → AI analysis → categorize → invalidate cache.
 * Returns immediately with instanceId; use /analysis/status/:instanceId to poll.
 */
app.post('/regenerate-analysis/:projectId', ingestKeyMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const workflow = c.env?.AI_ANALYSIS_WORKFLOW

  if (!workflow) return c.json({ error: 'AI_ANALYSIS_WORKFLOW binding not available' }, 500)

  const body = await c.req.json().catch(() => ({})) as { force?: boolean }
  const force = body?.force !== false // default true

  try {
    const instance = await workflow.create({ params: { projectId, force } })
    return c.json({ triggered: true, instanceId: instance.id, projectId })
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err) }, 500)
  }
})

/**
 * GET /api/admin/analysis/status/:instanceId
 *
 * Returns the status of a running or completed AI analysis workflow instance.
 */
app.get('/analysis/status/:instanceId', ingestKeyMiddleware, async (c) => {
  const instanceId = c.req.param('instanceId')
  const workflow = c.env?.AI_ANALYSIS_WORKFLOW

  if (!workflow) return c.json({ error: 'AI_ANALYSIS_WORKFLOW binding not available' }, 500)

  try {
    const instance = await workflow.get(instanceId)
    const status = await instance.status()
    return c.json({ instanceId, status: status.status, output: status.output ?? null, error: status.error ?? null })
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err) }, 404)
  }
})

// ── IDL Sync Status ───────────────────────────────────────────────────────────

/**
 * GET /api/admin/sync/status
 *
 * Returns the most recent sync_runs row so the frontend can display
 * when the last sync ran and how many programs were updated.
 * Public read — no auth required.
 */
app.get('/sync/status', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database not available' }, 500)

  try {
    const latest = await db
      .prepare(
        `SELECT id, started_at, completed_at, total_checked,
                updated_count, unchanged_count, skipped_count, error_count, trigger,
                total_programs, status
         FROM sync_runs
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .first()

    const todayRow = await db
      .prepare(`SELECT COUNT(*) AS total FROM update_logs WHERE detected_at >= date('now')`)
      .first()
    const updated_today = Number((todayRow as any)?.total ?? 0)

    return c.json({ run: latest ?? null, updated_today })
  } catch (err) {
    console.error('[admin] sync/status error:', err)
    return c.json({ error: 'Failed to fetch sync status', details: String(err) }, 500)
  }
})

/**
 * GET /api/admin/sync/history?page=1&limit=20
 *
 * Paginated log of IDL version changes detected during sync runs.
 * Public read — no auth required.
 */
app.get('/sync/history', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database not available' }, 500)

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '20')))
  const offset = (page - 1) * limit

  try {
    // Sequential queries — D1 can have issues with concurrent .all() + .first()
    const rows = await db
      .prepare(
        `SELECT ul.id, ul.project_id, ul.program_id, ul.program_name,
                ul.old_version, ul.new_version, ul.old_hash, ul.new_hash,
                ul.detected_at, p.name AS project_name
         FROM update_logs ul
         LEFT JOIN projects p ON p.id = ul.project_id
         ORDER BY ul.detected_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(limit, offset)
      .all()

    const countRow = await db
      .prepare('SELECT COUNT(*) AS total FROM update_logs')
      .first()

    // D1 may return BigInt for COUNT — coerce explicitly
    const total = Number((countRow as any)?.total ?? 0)

    return c.json({
      updates: rows.results ?? [],
      pagination: {
        page,
        limit,
        total,
        totalPages: total > 0 ? Math.ceil(total / limit) : 0,
      },
    })
  } catch (err) {
    console.error('[admin] sync/history error:', err)
    return c.json({ error: 'Failed to fetch sync history', details: String(err) }, 500)
  }
})

/**
 * GET /api/admin/sync/discovery?days=7&limit=50
 *
 * Programs added to the registry recently (via sync or CLI ingest).
 * Public read — no auth required.
 */
app.get('/sync/discovery', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database not available' }, 500)

  const days = Math.min(90, Math.max(1, parseInt(c.req.query('days') ?? '7')))
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') ?? '50')))

  try {
    const rows = await db
      .prepare(
        `SELECT p.id, p.name, p.program_id, p.created_at,
                pc.category, pc.tags
         FROM projects p
         LEFT JOIN program_categories pc ON pc.project_id = p.id
         WHERE p.is_public = 1
           AND p.created_at >= datetime('now', ? || ' days')
         ORDER BY p.created_at DESC
         LIMIT ?`,
      )
      .bind(`-${days}`, limit)
      .all()

    return c.json({ programs: rows.results ?? [], days })
  } catch (err) {
    console.error('[admin] sync/discovery error:', err)
    return c.json({ error: 'Failed to fetch discovery feed', details: String(err) }, 500)
  }
})

/**
 * POST /api/admin/sync/trigger
 *
 * Triggers IdlSyncWorkflow — durable, retriable IDL sync for all public projects.
 * Falls back to legacy waitUntil if IDL_SYNC_WORKFLOW binding unavailable.
 * Auth: X-Ingest-Key header required.
 */
app.post('/sync/trigger', ingestKeyMiddleware, async (c) => {
  const env = c.env

  if (env?.IDL_SYNC_WORKFLOW) {
    try {
      const instance = await env.IDL_SYNC_WORKFLOW.create({ params: { trigger: 'manual' } })
      return c.json({ triggered: true, instanceId: instance.id, message: 'IdlSyncWorkflow started' })
    } catch (err: any) {
      return c.json({ error: String(err?.message ?? err) }, 500)
    }
  }

  // Legacy fallback
  if (!env?.DB) return c.json({ error: 'Database not available' }, 500)
  c.executionCtx.waitUntil(
    runDailyIdlSync(
      {
        DB: env.DB,
        IDLS: env.IDLS,
        CACHE: env.CACHE,
        AI: env.AI as any,
        SOLANA_RPC_URL: env.SOLANA_RPC_URL,
        SOLANA_MAINNET_RPC_URL: env.SOLANA_MAINNET_RPC_URL,
      },
      'manual',
    ),
  )
  return c.json({ triggered: true, message: 'IDL sync started in background (legacy)' })
})

/**
 * POST /api/admin/sync/trigger-update-cache/:projectId
 *
 * Triggers IdlUpdateCacheWorkflow for a single project — rebuilds IDL summary,
 * docs, AI analysis, category, and clears stale CACHE keys.
 * Auth: X-Ingest-Key header required.
 */
app.post('/sync/trigger-update-cache/:projectId', ingestKeyMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const workflow = c.env?.IDL_UPDATE_CACHE_WORKFLOW
  if (!workflow) return c.json({ error: 'IDL_UPDATE_CACHE_WORKFLOW binding not available' }, 500)

  const body = await c.req.json().catch(() => ({})) as { force?: boolean }
  const force = body?.force === true

  try {
    const instance = await workflow.create({ params: { projectId, force } })
    return c.json({ triggered: true, instanceId: instance.id, projectId })
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err) }, 500)
  }
})

// ── Candidates Queue Stats ────────────────────────────────────────────────────

/**
 * GET /api/admin/sync/candidates
 *
 * Returns counts of program_candidates by status so the dashboard can show
 * how many programs are in the queue, verified, or skipped.
 * Public read — no auth required.
 */
app.get('/sync/candidates', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database not available' }, 500)

  try {
    const row = await db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END), 0) AS pending,
           COALESCE(SUM(CASE WHEN status = 'has_idl'  THEN 1 ELSE 0 END), 0) AS has_idl,
           COALESCE(SUM(CASE WHEN status = 'no_idl'   THEN 1 ELSE 0 END), 0) AS no_idl
         FROM program_candidates`,
      )
      .first()

    const stats = {
      total: Number((row as any)?.total ?? 0),
      pending: Number((row as any)?.pending ?? 0),
      has_idl: Number((row as any)?.has_idl ?? 0),
      no_idl: Number((row as any)?.no_idl ?? 0),
    }

    return c.json({
      stats,
    })
  } catch (err) {
    console.error('[admin] sync/candidates error:', err)
    return c.json({ error: 'Failed to fetch candidate stats', details: String(err) }, 500)
  }
})

/**
 * GET /api/admin/sync/scan-metadata
 *
 * Returns the most recent daily scan summary written by GitHub Actions
 * (via POST /api/ingest/scan-metadata). Returns null if no scan has run yet.
 * Public read — no auth required.
 */
app.get('/sync/scan-metadata', async (c) => {
  const cache = (c.env as any)?.CACHE
  if (!cache) return c.json({ metadata: null })

  try {
    const raw = await cache.get('scan:metadata', 'text')
    if (!raw) return c.json({ metadata: null })
    return c.json({ metadata: JSON.parse(raw) })
  } catch (err) {
    console.error('[admin] sync/scan-metadata error:', err)
    return c.json({ metadata: null })
  }
})

/**
 * GET /api/admin/sync/verified-build-metadata
 *
 * Returns latest verified-build summary written by the funnel CLI
 * (via POST /api/ingest/verified-build-metadata).
 * Public read — no auth required.
 */
app.get('/sync/verified-build-metadata', async (c) => {
  const cache = (c.env as any)?.CACHE
  if (!cache) return c.json({ metadata: null })

  try {
    const raw = await cache.get('verified-build:metadata', 'text')
    if (!raw) return c.json({ metadata: null })
    return c.json({ metadata: JSON.parse(raw) })
  } catch (err) {
    console.error('[admin] sync/verified-build-metadata error:', err)
    return c.json({ metadata: null })
  }
})

/**
 * GET /api/admin/sync/verified-build-total
 *
 * Fetches OSEC verified program total from https://verify.osec.io/verified-programs
 * and caches it in KV for a short period to avoid excessive upstream requests.
 * Public read — no auth required.
 */
app.get('/sync/verified-build-total', async (c) => {
  const cache = (c.env as any)?.CACHE
  const cacheKey = 'verified-build:osec-total'

  try {
    if (cache) {
      const raw = await cache.get(cacheKey, 'text')
      if (raw) {
        const parsed = JSON.parse(raw) as {
          total: number
          fetched_at: string
          source: string
        }
        const fetchedMs = Date.parse(parsed.fetched_at)
        if (Number.isFinite(fetchedMs) && Date.now() - fetchedMs < 15 * 60 * 1000) {
          return c.json({ ...parsed, cached: true })
        }
      }
    }

    const response = await fetch('https://verify.osec.io/verified-programs', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      throw new Error(`osec returned ${response.status}`)
    }

    const json = await response.json() as any
    const total = Number(
      json?.meta?.total ??
      (Array.isArray(json?.verified_programs) ? json.verified_programs.length : 0),
    )

    const payload = {
      total: Number.isFinite(total) ? total : 0,
      fetched_at: new Date().toISOString(),
      source: 'osec-verify',
    }

    if (cache) {
      await cache.put(cacheKey, JSON.stringify(payload), { expirationTtl: 6 * 60 * 60 })
    }

    return c.json({ ...payload, cached: false })
  } catch (err) {
    console.error('[admin] sync/verified-build-total error:', err)

    if (cache) {
      try {
        const raw = await cache.get(cacheKey, 'text')
        if (raw) {
          const parsed = JSON.parse(raw)
          return c.json({ ...parsed, cached: true, stale: true })
        }
      } catch {
        // ignore stale cache read error
      }
    }

    return c.json({ error: 'Failed to fetch verified-build total' }, 502)
  }
})

/**
 * GET /api/admin/sync/program-metrics/:programId
 *
 * Returns Solana Compass activity metrics for a single program address.
 * Returns null if no data has been imported for this program yet.
 * Public read — no auth required.
 */
app.get('/sync/program-metrics/:programId', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database not available' }, 500)
  const programId = c.req.param('programId')
  try {
    const row = await db
      .prepare(
        `SELECT program_id, tx_count_7d, unique_users_7d, fees_sol_7d,
                compute_units_7d, compass_name, compass_labels, fetched_at
         FROM program_metrics
         WHERE program_id = ?`,
      )
      .bind(programId)
      .first()
    return c.json({ metrics: row ?? null })
  } catch {
    return c.json({ metrics: null })
  }
})

/**
 * GET /api/admin/sync/program-metrics-status
 *
 * Returns total count and last fetch timestamp from the program_metrics table.
 * Public read — no auth required.
 */
app.get('/sync/program-metrics-status', async (c) => {
  const db = c.env?.DB
  if (!db) return c.json({ error: 'Database not available' }, 500)
  try {
    const row = await db
      .prepare(`SELECT COUNT(*) AS total, MAX(fetched_at) AS last_fetched FROM program_metrics`)
      .first()
    return c.json({
      total: Number((row as any)?.total ?? 0),
      last_fetched: (row as any)?.last_fetched ?? null,
    })
  } catch {
    return c.json({ total: 0, last_fetched: null })
  }
})

/**
 * POST /api/admin/sync/trigger-metrics
 *
 * Create a Cloudflare Workflow instance for the program metrics import.
 * Runs durably in the background — each page is a separate step with retries.
 * Auth: X-Ingest-Key header required.
 */
app.post('/sync/trigger-metrics', ingestKeyMiddleware, async (c) => {
  const env = c.env

  if (!env?.PROGRAM_METRICS_WORKFLOW) return c.json({ error: 'Workflow binding not available' }, 500)

  try {
    const instance = await env.PROGRAM_METRICS_WORKFLOW.create()
    return c.json({
      triggered: true,
      instanceId: instance.id,
      message: 'Program metrics workflow started — check status at /sync/program-metrics-status',
    })
  } catch (err: any) {
    return c.json({ error: String(err?.message ?? err) }, 500)
  }
})

/**
 * POST /api/admin/sync/run-metrics
 *
 * Synchronous import — awaits completion and returns result.
 * Blocks until all pages fetched and inserted (~30s for 4000 programs).
 * Auth: X-Ingest-Key header required.
 */
app.post('/sync/run-metrics', ingestKeyMiddleware, async (c) => {
  const env = c.env

  if (!env?.DB) return c.json({ error: 'Database not available' }, 500)

  // Verify table exists before starting
  try {
    await env.DB.prepare(`SELECT 1 FROM program_metrics LIMIT 1`).first()
  } catch (tableErr: any) {
    return c.json({
      error: 'program_metrics table missing — run migration 020 first',
      detail: String(tableErr?.message ?? tableErr),
    }, 500)
  }

  try {
    const result = await importProgramMetrics({ DB: env.DB })
    return c.json({ ok: true, imported: result.imported, pages: result.pages })
  } catch (err: any) {
    return c.json({ ok: false, error: String(err?.message ?? err) }, 500)
  }
})

export default app
