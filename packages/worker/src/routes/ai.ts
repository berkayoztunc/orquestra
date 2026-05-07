import { Hono } from 'hono'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { generateDocumentation } from '../services/doc-generator'
import { generateAndStoreAIAnalysis } from '../services/ai-analysis'
import type { AnchorIDL } from '../services/idl-parser'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    IDLS: any
    CACHE: any
    API_BASE_URL: string
    INGEST_API_KEY: string
    AI: Ai
    AI_ANALYSIS_MODEL?: string
  }
}

const app = new Hono<Env>()

function serializeAnalysis(analysis: any) {
  let detailedAnalysis: Record<string, any> | null = null
  if (analysis.detailed_analysis_json) {
    try {
      detailedAnalysis = JSON.parse(analysis.detailed_analysis_json as string)
    } catch {
      detailedAnalysis = null
    }
  }

  return {
    id: analysis.id,
    projectId: analysis.project_id,
    idlVersionId: analysis.idl_version_id,
    idlVersion: analysis.idl_version,
    shortDescription: analysis.short_description,
    detailedAnalysis,
    modelUsed: analysis.model_used,
    generatedAt: analysis.generated_at,
    createdAt: analysis.created_at,
  }
}

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

    return c.json({
      analysis: serializeAnalysis(analysis),
    })
  } catch (err) {
    return c.json({ error: 'Failed to fetch AI analysis', details: (err as Error).message }, 500)
  }
})

/**
 * POST /api/projects/:projectId/ai-analysis/regenerate
 *
 * Regenerates AI analysis for the latest IDL version. Owner only.
 */
app.post('/projects/:projectId/ai-analysis/regenerate', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const db = c.env?.DB

    const project = await db
      ?.prepare('SELECT id, name, program_id, user_id FROM projects WHERE id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first()

    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    if (!c.env?.AI) {
      return c.json({ error: 'AI binding not configured' }, 500)
    }

    const row = await db
      ?.prepare(
        'SELECT id, idl_json, cpi_md, version FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1',
      )
      .bind(projectId)
      .first()

    if (!row) {
      return c.json({ error: 'IDL not found' }, 404)
    }

    const idl = JSON.parse(row.idl_json as string) as AnchorIDL
    const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'
    const docs = generateDocumentation(
      idl,
      project.program_id as string,
      apiBaseUrl,
      projectId,
      (row.cpi_md as string | null) ?? null,
    )

    if (c.env?.CACHE) {
      await c.env.CACHE.put(`docs:${projectId}`, docs.full, { expirationTtl: 604800 })
    }

    const generated = await generateAndStoreAIAnalysis({
      db,
      ai: c.env.AI,
      id: generateId(),
      projectId,
      idlVersionId: row.id as string,
      idl,
      docsText: docs.full,
      programId: project.program_id as string,
      projectName: project.name as string,
      model: c.env.AI_ANALYSIS_MODEL,
      now: getCurrentTimestamp(),
    })

    return c.json({
      analysis: {
        id: generated.id,
        projectId: generated.projectId,
        idlVersionId: generated.idlVersionId,
        idlVersion: row.version,
        shortDescription: generated.shortDescription,
        detailedAnalysis: generated.detailedAnalysis,
        modelUsed: generated.modelUsed,
        generatedAt: generated.generatedAt,
        createdAt: generated.createdAt,
      },
    })
  } catch (err) {
    console.error('[ai] Failed to regenerate AI analysis:', err)
    return c.json({ error: 'Failed to regenerate AI analysis', details: (err as Error).message }, 500)
  }
})

export default app
