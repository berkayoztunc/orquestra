import { Hono } from 'hono'
import { ingestKeyMiddleware } from '../middleware/auth'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { generateAndStoreAIAnalysis } from '../services/ai-analysis'
import { generateDocumentation } from '../services/doc-generator'
import { generateId } from '../utils/id'
import { runDailyIdlSync } from '../services/idl-sync'

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
 * Retroactively AI-categorize all public projects that have no entry in
 * program_categories yet. Processing happens in the background via
 * executionCtx.waitUntil — the endpoint returns immediately with a count
 * of how many projects were queued.
 *
 * Auth: X-Ingest-Key header (reuses the existing INGEST_API_KEY secret)
 */
app.post('/recategorize', ingestKeyMiddleware, async (c) => {
  const db = c.env?.DB
  const ai = c.env?.AI

  if (!db) {
    return c.json({ error: 'Database not available' }, 500)
  }
  if (!ai) {
    return c.json({ error: 'Workers AI binding not available' }, 500)
  }

  // Fetch all projects that have no program_categories row yet.
  // We also pull the latest IDL so we can extract instruction/account names.
  const rows = await db
    .prepare(
      `SELECT
         p.id        AS project_id,
         p.name,
         p.description,
         p.program_id,
         iv.idl_json
       FROM projects p
       LEFT JOIN program_categories pc ON pc.project_id = p.id
       LEFT JOIN idl_versions iv ON iv.id = (
         SELECT id FROM idl_versions
         WHERE project_id = p.id
         ORDER BY version DESC
         LIMIT 1
       )
       WHERE pc.id IS NULL
       ORDER BY p.created_at DESC
       LIMIT 500`
    )
    .all()

  const uncategorized = (rows.results || []) as Array<{
    project_id: string
    name: string
    description: string | null
    program_id: string
    idl_json: string | null
  }>

  if (uncategorized.length === 0) {
    return c.json({ queued: 0, message: 'All projects are already categorized.' })
  }

  // Fire all categorizations in the background — one at a time to respect
  // Workers AI rate limits (sequential, not parallel).
  c.executionCtx.waitUntil(
    (async () => {
      for (const row of uncategorized) {
        try {
          let idl: Record<string, any> = {}
          if (row.idl_json) {
            try { idl = JSON.parse(row.idl_json) } catch { /* ignore */ }
          }

          const result = await categorizeProgramWithAI(ai, {
            name: row.name,
            description: row.description,
            programId: row.program_id,
            instructions: extractInstructionNames(idl),
            accounts: extractAccountNames(idl),
          })

          await setCategoryAndAliases(db, row.project_id, result.category, result.tags, result.aliases)
        } catch (err) {
          console.error(`[admin] Recategorize failed for project ${row.project_id}:`, err)
        }
      }
    })()
  )

  return c.json({ queued: uncategorized.length })
})

// ── Regenerate AI Analysis ────────────────────────────────────────────────────

/**
 * POST /api/admin/regenerate-analysis/:projectId
 *
 * Fetches the latest IDL version from DB, deletes the existing AI analysis,
 * and regenerates it. Returns the new analysis.
 */
app.post('/regenerate-analysis/:projectId', ingestKeyMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const db = c.env?.DB
  const ai = c.env?.AI

  if (!db) return c.json({ error: 'Database not available' }, 500)
  if (!ai) return c.json({ error: 'Workers AI binding not available' }, 500)

  const project = await db
    .prepare('SELECT name, program_id, is_public FROM projects WHERE id = ?')
    .bind(projectId)
    .first()

  if (!project) return c.json({ error: 'Project not found' }, 404)

  const idlRow = await db
    .prepare('SELECT id, idl_json, cpi_md FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1')
    .bind(projectId)
    .first()

  if (!idlRow) return c.json({ error: 'No IDL version found for project' }, 404)

  const idl = JSON.parse(idlRow.idl_json as string)
  const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'

  const docs = generateDocumentation(idl, project.program_id as string, apiBaseUrl, projectId, idlRow.cpi_md as string | null)

  await db.prepare('DELETE FROM ai_analyses WHERE project_id = ?').bind(projectId).run()

  const now = new Date().toISOString()
  const analysis = await generateAndStoreAIAnalysis({
    db,
    ai,
    id: generateId(),
    projectId,
    idlVersionId: idlRow.id as string,
    idl,
    docsText: docs.full,
    programId: project.program_id as string,
    projectName: project.name as string,
    now,
  })

  if (c.env?.CACHE) {
    await c.env.CACHE.delete(`docs:${projectId}`)
  }

  return c.json({ ok: true, projectId, analysisId: analysis.id, generatedAt: analysis.generatedAt })
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

    return c.json({ run: latest ?? null })
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
 * Manually trigger an IDL sync run in the background.
 * Auth: X-Ingest-Key header required.
 */
app.post('/sync/trigger', ingestKeyMiddleware, async (c) => {
  const env = c.env

  if (!env?.DB) return c.json({ error: 'Database not available' }, 500)

  // Fire sync in the background — don't block the response
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

  return c.json({ triggered: true, message: 'IDL sync started in background' })
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

export default app
