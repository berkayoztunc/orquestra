import { Hono } from 'hono'
import { ingestKeyMiddleware } from '../middleware/auth'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { generateAndStoreAIAnalysis } from '../services/ai-analysis'
import { generateDocumentation } from '../services/doc-generator'
import { generateId } from '../utils/id'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    AI: Ai
    CACHE: any
    API_BASE_URL: string
    INGEST_API_KEY: string
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

export default app
