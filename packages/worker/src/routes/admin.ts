import { Hono } from 'hono'
import { ingestKeyMiddleware } from '../middleware/auth'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    AI: Ai
    INGEST_API_KEY: string
  }
}

const app = new Hono<Env>()

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

export default app
