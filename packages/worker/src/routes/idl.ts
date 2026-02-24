import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { uploadRateLimit } from '../middleware/rate-limit'
import { validateIDL, parseIDL } from '../services/idl-parser'
import { generateDocumentation } from '../services/doc-generator'
import { validateIDLUpload } from '../services/validation'

const MAX_IDL_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_CPI_SIZE = 5 * 1024 * 1024 // 5MB

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
    IDLS: any  // KV namespace
    CACHE: any // KV namespace
    API_BASE_URL: string
  }
}

const app = new Hono<Env>()

// Upload IDL - Creates a new project with IDL
app.post('/upload', uploadRateLimit, authMiddleware, async (c) => {
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<{
      name: string
      description?: string
      programId: string
      idl: any
      cpiMd?: string
      isPublic?: boolean
    }>()

    // Validate required fields
    if (!body.name || !body.programId || !body.idl) {
      return c.json({ error: 'Missing required fields: name, programId, idl' }, 400)
    }

    // Validate IDL size
    const idlStr = JSON.stringify(body.idl)
    if (idlStr.length > MAX_IDL_SIZE) {
      return c.json({ error: `IDL exceeds maximum size of ${MAX_IDL_SIZE / 1024 / 1024}MB` }, 400)
    }

    // Validate CPI.md size
    if (body.cpiMd && body.cpiMd.length > MAX_CPI_SIZE) {
      return c.json({ error: `CPI.md exceeds maximum size of ${MAX_CPI_SIZE / 1024 / 1024}MB` }, 400)
    }

    // Validate IDL structure
    const validation = validateIDL(body.idl)
    if (!validation.valid) {
      return c.json({
        error: 'Invalid IDL structure',
        details: validation.errors,
        warnings: validation.warnings,
      }, 400)
    }

    const parsed = parseIDL(body.idl)
    const db = c.env?.DB
    const kv = c.env?.IDLS
    const projectId = generateId()
    const projectSlug = slugify(body.name)
    const now = getCurrentTimestamp()

    // Check for duplicate project (same user + program ID)
    const existing = await db
      ?.prepare('SELECT id FROM projects WHERE user_id = ? AND program_id = ?')
      .bind(userId, body.programId)
      .first()

    if (existing) {
      return c.json({
        error: 'Project already exists for this program ID',
        existingProjectId: existing.id,
      }, 409)
    }

    // Create project
    await db
      ?.prepare(
        'INSERT INTO projects (id, user_id, name, description, program_id, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(projectId, userId, body.name, body.description || '', body.programId, body.isPublic !== false ? 1 : 0, now, now)
      .run()

    // Create IDL version
    const idlVersionId = generateId()
    await db
      ?.prepare(
        'INSERT INTO idl_versions (id, project_id, idl_json, cpi_md, version, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(idlVersionId, projectId, idlStr, body.cpiMd || null, 1, now)
      .run()

    // Create default socials entry
    await db
      ?.prepare(
        'INSERT INTO project_socials (id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?)'
      )
      .bind(generateId(), projectId, now, now)
      .run()

    // Cache IDL in KV
    if (kv) {
      await kv.put(`idl:${projectId}:latest`, idlStr, { expirationTtl: 604800 }) // 7 days
      await kv.put(`idl:${projectId}:1`, idlStr, { expirationTtl: 604800 })
    }

    // Generate documentation and cache
    const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'
    const docs = generateDocumentation(parsed.idl, body.programId, apiBaseUrl, projectId, body.cpiMd)
    if (c.env?.CACHE) {
      await c.env.CACHE.put(`docs:${projectId}`, docs.full, { expirationTtl: 604800 })
    }

    return c.json({
      project: {
        id: projectId,
        name: body.name,
        slug: projectSlug,
        programId: body.programId,
        isPublic: body.isPublic !== false,
      },
      idl: {
        versionId: idlVersionId,
        version: 1,
        programName: parsed.programName,
        instructionCount: parsed.instructionCount,
        accountCount: parsed.accountCount,
        errorCount: parsed.errorCount,
        eventCount: parsed.eventCount,
      },
      validation: {
        warnings: validation.warnings,
      },
    }, 201)
  } catch (err) {
    console.error('IDL upload error:', err)
    return c.json({ error: 'Failed to upload IDL', details: (err as Error).message }, 500)
  }
})

// Get IDL by project
app.get('/:projectId', async (c) => {
  const projectId = c.req.param('projectId')
  const version = c.req.query('version')

  try {
    // Try KV cache first
    const kv = c.env?.IDLS
    const cacheKey = version ? `idl:${projectId}:${version}` : `idl:${projectId}:latest`

    if (kv) {
      const cached = await kv.get(cacheKey)
      if (cached) {
        return c.json({
          projectId,
          idl: JSON.parse(cached),
          source: 'cache',
        })
      }
    }

    // Fall back to database
    const db = c.env?.DB
    let query = 'SELECT iv.*, p.name as project_name, p.program_id FROM idl_versions iv JOIN projects p ON iv.project_id = p.id WHERE iv.project_id = ?'
    const params: any[] = [projectId]

    if (version) {
      query += ' AND iv.version = ?'
      params.push(parseInt(version))
    } else {
      query += ' ORDER BY iv.version DESC LIMIT 1'
    }

    const result = await db?.prepare(query).bind(...params).first()

    if (!result) {
      return c.json({ error: 'IDL not found' }, 404)
    }

    const idlJson = JSON.parse(result.idl_json as string)

    // Update KV cache
    if (kv) {
      await kv.put(cacheKey, result.idl_json as string, { expirationTtl: 604800 })
    }

    return c.json({
      projectId,
      projectName: result.project_name,
      programId: result.program_id,
      version: result.version,
      idl: idlJson,
      cpiMd: result.cpi_md,
      createdAt: result.created_at,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get IDL', details: (err as Error).message }, 500)
  }
})

// List IDL versions for a project
app.get('/:projectId/versions', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const db = c.env?.DB
    const results = await db
      ?.prepare(
        'SELECT id, version, created_at FROM idl_versions WHERE project_id = ? ORDER BY version DESC'
      )
      .bind(projectId)
      .all()

    return c.json({
      projectId,
      versions: results?.results || [],
    })
  } catch (err) {
    return c.json({ error: 'Failed to list versions' }, 500)
  }
})

// Update IDL (creates a new version)
app.put('/:projectId', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<{
      idl: any
      cpiMd?: string
    }>()

    if (!body.idl) {
      return c.json({ error: 'Missing required field: idl' }, 400)
    }

    const db = c.env?.DB

    // Check project ownership
    const project = await db
      ?.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first()

    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    // Validate IDL
    const validation = validateIDL(body.idl)
    if (!validation.valid) {
      return c.json({ error: 'Invalid IDL', details: validation.errors }, 400)
    }

    const parsed = parseIDL(body.idl)
    const idlStr = JSON.stringify(body.idl)

    // Get next version number
    const lastVersion = await db
      ?.prepare('SELECT MAX(version) as max_version FROM idl_versions WHERE project_id = ?')
      .bind(projectId)
      .first()

    const newVersion = ((lastVersion as any)?.max_version || 0) + 1
    const idlVersionId = generateId()
    const now = getCurrentTimestamp()

    // Insert new version
    await db
      ?.prepare(
        'INSERT INTO idl_versions (id, project_id, idl_json, cpi_md, version, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(idlVersionId, projectId, idlStr, body.cpiMd || null, newVersion, now)
      .run()

    // Update project timestamp
    await db?.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, projectId).run()

    // Update KV cache
    const kv = c.env?.IDLS
    if (kv) {
      await kv.put(`idl:${projectId}:latest`, idlStr, { expirationTtl: 604800 })
      await kv.put(`idl:${projectId}:${newVersion}`, idlStr, { expirationTtl: 604800 })
    }

    // Regenerate docs
    const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'
    const docs = generateDocumentation(parsed.idl, project.program_id as string, apiBaseUrl, projectId, body.cpiMd)
    if (c.env?.CACHE) {
      await c.env.CACHE.put(`docs:${projectId}`, docs.full, { expirationTtl: 604800 })
    }

    return c.json({
      versionId: idlVersionId,
      version: newVersion,
      programName: parsed.programName,
      instructionCount: parsed.instructionCount,
      warnings: validation.warnings,
    })
  } catch (err) {
    return c.json({ error: 'Failed to update IDL', details: (err as Error).message }, 500)
  }
})

// Delete project and all IDL versions (requires name confirmation)
app.delete('/:projectId', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<{ confirmName: string }>().catch(() => ({ confirmName: '' }))

    const db = c.env?.DB

    // Check ownership
    const project = await db
      ?.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first()

    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    // Require name confirmation
    if (!body.confirmName || body.confirmName !== project.name) {
      return c.json({
        error: 'Confirmation required: please provide the project name to confirm deletion',
        requiredName: project.name,
      }, 400)
    }

    // Delete cascading (foreign keys handle related records)
    await db?.prepare('DELETE FROM known_addresses WHERE project_id = ?').bind(projectId).run()
    await db?.prepare('DELETE FROM api_keys WHERE project_id = ?').bind(projectId).run()
    await db?.prepare('DELETE FROM project_socials WHERE project_id = ?').bind(projectId).run()
    await db?.prepare('DELETE FROM idl_versions WHERE project_id = ?').bind(projectId).run()
    await db?.prepare('DELETE FROM projects WHERE id = ?').bind(projectId).run()

    // Clean KV cache
    const kv = c.env?.IDLS
    if (kv) {
      await kv.delete(`idl:${projectId}:latest`)
    }
    if (c.env?.CACHE) {
      await c.env.CACHE.delete(`docs:${projectId}`)
    }

    return c.json({ message: 'Project and all associated data deleted', projectId })
  } catch (err) {
    return c.json({ error: 'Failed to delete project', details: (err as Error).message }, 500)
  }
})

export default app
