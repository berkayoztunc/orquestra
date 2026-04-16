import { Hono } from 'hono'
import { ingestKeyMiddleware } from '../middleware/auth'
import { autoSeedCategory } from '../services/program-auto-detect'

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-')
}

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
 * POST /api/ingest/idl
 *
 * CLI-driven bulk ingest: receives a discovered IDL + optional AI analysis
 * and persists everything to D1 (projects, idl_versions, ai_analyses tables).
 *
 * Auth: X-Ingest-Key header (INGEST_API_KEY Worker secret)
 *
 * Upsert logic:
 *  - Find project by program_id
 *    - Not found → create new project (is_public = true, user_id = 'system')
 *  - Check idl_hash of latest idl_version
 *    - Same hash → no new version, just upsert AI analysis if provided
 *    - Different hash (or no version yet) → create new idl_version (version++)
 *  - Upsert ai_analyses row if aiDescription or aiAnalysisJson is provided
 */
app.post('/idl', ingestKeyMiddleware, async (c) => {
  try {
    const body = await c.req.json<{
      programId: string
      idl: Record<string, any>
      idlHash: string
      programName?: string
      programDescription?: string
      aiDescription?: string | null
      aiAnalysisJson?: string | null
      aiModelUsed?: string | null
      aiGeneratedAt?: string | null
    }>()

    if (!body.programId || !body.idl || !body.idlHash) {
      return c.json({ error: 'Missing required fields: programId, idl, idlHash' }, 400)
    }

    const db = c.env?.DB
    const kv = c.env?.IDLS

    if (!db) {
      return c.json({ error: 'Database not available' }, 500)
    }

    const now = getCurrentTimestamp()
    const idlStr = JSON.stringify(body.idl)
    const MAX_IDL_SIZE = 10 * 1024 * 1024
    if (idlStr.length > MAX_IDL_SIZE) {
      return c.json({ error: 'IDL exceeds maximum size of 10MB' }, 400)
    }

    // Resolve program name from body or IDL
    const rawProgramName: string =
      body.programName ||
      (typeof body.idl.name === 'string' ? body.idl.name : null) ||
      (body.idl.metadata && typeof body.idl.metadata.name === 'string' ? body.idl.metadata.name : null) ||
      body.programId

    const programName = rawProgramName.trim() || body.programId
    const programDescription = body.programDescription || ''

    // ── 1. Find or create project ──────────────────────────────────
    let project = await db
      .prepare('SELECT id, name FROM projects WHERE program_id = ? LIMIT 1')
      .bind(body.programId)
      .first()

    let projectId: string
    let created = false

    if (!project) {
      projectId = generateId()
      const slug = slugify(programName)
      await db
        .prepare(
          'INSERT INTO projects (id, user_id, name, description, program_id, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(projectId, 'system', programName, programDescription, body.programId, 1, now, now)
        .run()

      // Create default socials entry
      await db
        .prepare('INSERT INTO project_socials (id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .bind(generateId(), projectId, now, now)
        .run()

      // Auto-detect and seed category if known program
      await autoSeedCategory(db, projectId, programName)

      created = true
    } else {
      projectId = project.id as string
    }

    // ── 2. Check latest IDL version hash ──────────────────────────
    const latestVersion = await db
      .prepare('SELECT id, version, idl_hash FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1')
      .bind(projectId)
      .first()

    let idlVersionId: string
    let newVersion = false

    const existingHash = latestVersion?.idl_hash as string | null
    const existingVersionNum = (latestVersion?.version as number) || 0

    if (!latestVersion || existingHash !== body.idlHash) {
      // New version needed
      idlVersionId = generateId()
      const nextVersion = existingVersionNum + 1
      await db
        .prepare(
          'INSERT INTO idl_versions (id, project_id, idl_json, idl_hash, version, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .bind(idlVersionId, projectId, idlStr, body.idlHash, nextVersion, now)
        .run()

      // Cache in KV
      if (kv) {
        await kv.put(`idl:${projectId}:latest`, idlStr, { expirationTtl: 604800 })
        await kv.put(`idl:${projectId}:${nextVersion}`, idlStr, { expirationTtl: 604800 })
      }

      // Invalidate docs cache on IDL change
      if (c.env?.CACHE) {
        await c.env.CACHE.delete(`docs:${projectId}`)
      }

      newVersion = true
    } else {
      idlVersionId = latestVersion.id as string
    }

    // ── 3. Upsert AI analysis ─────────────────────────────────────
    let aiAnalysisId: string | null = null

    if (body.aiDescription || body.aiAnalysisJson) {
      aiAnalysisId = generateId()
      await db
        .prepare(
          'INSERT INTO ai_analyses (id, project_id, idl_version_id, short_description, detailed_analysis_json, model_used, generated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(
          aiAnalysisId,
          projectId,
          idlVersionId,
          body.aiDescription ?? null,
          body.aiAnalysisJson ?? null,
          body.aiModelUsed ?? null,
          body.aiGeneratedAt ?? null,
          now,
        )
        .run()

      // Optionally cache the short description for fast access
      if (c.env?.CACHE && body.aiDescription) {
        await c.env.CACHE.put(`ai:desc:${projectId}`, body.aiDescription, { expirationTtl: 604800 })
      }
    }

    return c.json({
      projectId,
      idlVersionId,
      aiAnalysisId,
      created,
      newVersion,
    }, created ? 201 : 200)
  } catch (err) {
    console.error('Ingest error:', err)
    return c.json({ error: 'Failed to ingest IDL', details: (err as Error).message }, 500)
  }
})

export default app
