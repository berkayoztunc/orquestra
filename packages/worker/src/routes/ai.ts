import { Hono } from 'hono'
import { optionalAuthMiddleware } from '../middleware/auth'

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    IDLS: any
    CACHE: any
    API_BASE_URL: string
    INGEST_API_KEY: string
  }
}

const app = new Hono<Env>()

/**
 * GET /api/projects/:projectId/ai-analysis
 *
 * Returns the most recent AI analysis for a project.
 * Respects project visibility (private projects require ownership).
 */
app.get('/projects/:projectId/ai-analysis', optionalAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string | undefined

  try {
    const db = c.env?.DB

    // Verify project exists and check access
    const project = await db
      ?.prepare('SELECT id, is_public, user_id FROM projects WHERE id = ?')
      .bind(projectId)
      .first()

    if (!project) {
      return c.json({ error: 'Project not found' }, 404)
    }

    if (!project.is_public && project.user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // Fetch latest AI analysis
    const analysis = await db
      ?.prepare(
        `SELECT a.id, a.project_id, a.idl_version_id, a.short_description,
                a.detailed_analysis_json, a.model_used, a.generated_at, a.created_at,
                iv.version as idl_version
         FROM ai_analyses a
         LEFT JOIN idl_versions iv ON a.idl_version_id = iv.id
         WHERE a.project_id = ?
         ORDER BY a.created_at DESC
         LIMIT 1`
      )
      .bind(projectId)
      .first()

    if (!analysis) {
      return c.json({ analysis: null, message: 'No AI analysis available for this project' })
    }

    // Parse detailed_analysis_json if present
    let detailedAnalysis: Record<string, any> | null = null
    if (analysis.detailed_analysis_json) {
      try {
        detailedAnalysis = JSON.parse(analysis.detailed_analysis_json as string)
      } catch {
        detailedAnalysis = null
      }
    }

    return c.json({
      analysis: {
        id: analysis.id,
        projectId: analysis.project_id,
        idlVersionId: analysis.idl_version_id,
        idlVersion: analysis.idl_version,
        shortDescription: analysis.short_description,
        detailedAnalysis,
        modelUsed: analysis.model_used,
        generatedAt: analysis.generated_at,
        createdAt: analysis.created_at,
      },
    })
  } catch (err) {
    return c.json({ error: 'Failed to fetch AI analysis', details: (err as Error).message }, 500)
  }
})

export default app
