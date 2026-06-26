import { Hono } from 'hono'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { buildRateLimit } from '../middleware/rate-limit'
import { invalidateCache } from '../middleware/cache'
import { parseIDL, getInstruction, resolveType, getDefaultValue, expandInstructionArgs, getDefinedTypeName, resolveDefinedType, resolveAccountFields, resolveEventFields, normalizeAccountMeta, validateIDL, detectIDLFormat, getCodamaInstruction, getCodamaUserArgs, resolveCodamaType, describeCodamaDiscriminator, resolveCodamaAccountFields } from '../services/idl-parser'
import type { AnchorIDL, CodamaIDL } from '../services/idl-parser'
import { buildTransaction, validateBuildRequest, simulateRawTransaction } from '../services/tx-builder'
import { resolveSolanaRpcUrl, rpcUrlHost, fetchAccountInfo } from '../utils/solana-rpc'
import { listPdaAccounts, derivePda, listCodamaPdaAccounts, deriveCodamaPda } from '../services/pda'
import { detectAccountType, deserializeAccountData, detectCodamaAccountType, deserializeCodamaAccountData } from '../services/account-parser'
import { queryProgramAccounts, normalizeProgramAccountsQuery } from '../services/program-accounts'
import { generateDocumentation } from '../services/doc-generator'
import { PROGRAM_ACCOUNTS_SELECTOR_ERROR, hasProgramAccountsSelector, validateProjectInput, validateBuildRequest as validateBuildInput, validatePdaRequest } from '../services/validation'
import { fetchAnchorIDLFromChain } from '../services/idl-fetcher'
import { searchProjects } from '../services/search'
import { autoSeedCategory } from '../services/program-auto-detect'
import { getInstructionSummary, getPublicIdlSummary, readIdlSummaryCache, writeIdlSummaryCache } from '../services/idl-summary'
import { generateId } from '../utils/id'

function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

const CUSTOM_API_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type CustomApiMethod = (typeof CUSTOM_API_METHODS)[number]
type CustomApiParameter = { name: string; description: string; required?: boolean }
type CustomApiInput = {
  name?: string
  method?: string
  url?: string
  purpose?: string
  parameters?: CustomApiParameter[]
  exampleRequest?: string
  responseNotes?: string
  authNotes?: string
}
type CustomApiRow = {
  id: string
  project_id: string
  name: string
  method: CustomApiMethod
  url: string
  purpose: string
  parameters_json: string | null
  example_request: string | null
  response_notes: string | null
  auth_notes: string | null
  created_at: string
  updated_at: string
}

function isAllowedCustomApiUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true
  } catch {
    return false
  }
  return false
}

function containsLikelySecret(value: string): boolean {
  const withoutPlaceholders = value.replace(/<[^>\n]{1,80}>/g, '<placeholder>')
  const patterns = [
    /\bBearer\s+(?!<placeholder>)[A-Za-z0-9._~+/=-]{24,}/i,
    /\b(?:api[_-]?key|token|secret|password)\s*[:=]\s*(?!<placeholder>)[A-Za-z0-9._~+/=-]{16,}/i,
    /\bsk-[A-Za-z0-9]{20,}\b/i,
    /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/,
  ]
  return patterns.some((pattern) => pattern.test(withoutPlaceholders))
}

function validateCustomApiInput(body: CustomApiInput, partial = false): { ok: true; data: CustomApiInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Request body must be an object' }
  }

  const requiredFields: Array<keyof CustomApiInput> = ['name', 'method', 'url', 'purpose']
  if (!partial) {
    for (const field of requiredFields) {
      if (!body[field] || typeof body[field] !== 'string') {
        return { ok: false, error: `Missing required field: ${field}` }
      }
    }
  }

  if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 120)) {
    return { ok: false, error: 'Name is required and must be 120 characters or less' }
  }
  if (body.method !== undefined) {
    if (typeof body.method !== 'string') {
      return { ok: false, error: 'Method must be one of GET, POST, PUT, PATCH, DELETE' }
    }
    const method = body.method.toUpperCase()
    if (!CUSTOM_API_METHODS.includes(method as CustomApiMethod)) {
      return { ok: false, error: 'Method must be one of GET, POST, PUT, PATCH, DELETE' }
    }
    body.method = method
  }
  if (body.url !== undefined && (typeof body.url !== 'string' || body.url.length > 2048 || !isAllowedCustomApiUrl(body.url))) {
    return { ok: false, error: 'URL must be https:// or local http://localhost/127.0.0.1 and 2048 characters or less' }
  }
  if (body.purpose !== undefined && (typeof body.purpose !== 'string' || body.purpose.trim().length === 0 || body.purpose.length > 1000)) {
    return { ok: false, error: 'Purpose is required and must be 1000 characters or less' }
  }
  if (body.exampleRequest !== undefined && (typeof body.exampleRequest !== 'string' || body.exampleRequest.length > 5000)) {
    return { ok: false, error: 'Example request must be 5000 characters or less' }
  }
  if (body.responseNotes !== undefined && (typeof body.responseNotes !== 'string' || body.responseNotes.length > 5000)) {
    return { ok: false, error: 'Response notes must be 5000 characters or less' }
  }
  if (body.authNotes !== undefined) {
    if (typeof body.authNotes !== 'string' || body.authNotes.length > 1000) {
      return { ok: false, error: 'Auth notes must be 1000 characters or less' }
    }
    if (containsLikelySecret(body.authNotes)) {
      return { ok: false, error: 'Auth notes must use placeholders like Bearer <API_KEY>; do not store real secrets' }
    }
  }
  if (body.parameters !== undefined) {
    if (!Array.isArray(body.parameters) || body.parameters.length > 25) {
      return { ok: false, error: 'Parameters must be an array with at most 25 entries' }
    }
    for (const param of body.parameters) {
      if (!param || typeof param.name !== 'string' || param.name.trim().length === 0 || param.name.length > 120) {
        return { ok: false, error: 'Each parameter needs a name of 120 characters or less' }
      }
      if (typeof param.description !== 'string' || param.description.trim().length === 0 || param.description.length > 1000) {
        return { ok: false, error: 'Each parameter needs a description of 1000 characters or less' }
      }
    }
  }

  return { ok: true, data: body }
}

function parseCustomApiParameters(value: string | null): CustomApiParameter[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function serializeCustomApiRow(row: CustomApiRow) {
  return {
    id: row.id,
    project_id: row.project_id,
    name: row.name,
    method: row.method,
    url: row.url,
    purpose: row.purpose,
    parameters: parseCustomApiParameters(row.parameters_json),
    example_request: row.example_request,
    response_notes: row.response_notes,
    auth_notes: row.auth_notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    IDLS: any
    CACHE: any
    SOLANA_RPC_URL: string
    SOLANA_MAINNET_RPC_URL?: string
    SOLANA_DEVNET_RPC_URL?: string
    SOLANA_TESTNET_RPC_URL?: string
    API_BASE_URL: string
  }
}

const app = new Hono<Env>()

// ── Public Stats ──────────────────────────────────────

app.get('/stats', async (c) => {
  const db = c.env.DB
  try {
    const [users, projects, addresses] = await Promise.all([
      db.prepare('SELECT COUNT(*) as count FROM users WHERE id != ?').bind('system').first(),
      db.prepare('SELECT COUNT(*) as count FROM projects WHERE is_public = 1').first(),
      db.prepare('SELECT COUNT(*) as count FROM known_addresses').first(),
    ])
    return c.json({
      total_users: (users?.count as number) ?? 0,
      total_projects: (projects?.count as number) ?? 0,
      total_known_addresses: (addresses?.count as number) ?? 0,
    })
  } catch {
    return c.json({ error: 'Failed to fetch stats' }, 500)
  }
})

// List on-chain IDL update log entries (detected by daily cron)
app.get('/updates', async (c) => {
  const rawPage = parseInt(c.req.query('page') || '1', 10)
  const rawLimit = parseInt(c.req.query('limit') || '20', 10)
  const projectId = c.req.query('project_id') || ''
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20
  const offset = (page - 1) * limit

  try {
    const db = c.env?.DB

    const whereParts: string[] = []
    const params: (string | number)[] = []

    if (projectId) {
      whereParts.push('ul.project_id = ?')
      params.push(projectId)
    }

    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''

    const countResult = await db!
      .prepare(`SELECT COUNT(*) as count FROM update_logs ul ${where}`)
      .bind(...params)
      .first() as { count: number } | null

    const total = countResult?.count || 0

    const updates = await db!
      .prepare(
        `SELECT ul.id, ul.project_id, ul.program_id, ul.program_name,
                ul.old_version, ul.new_version, ul.old_hash, ul.new_hash, ul.detected_at
         FROM update_logs ul
         ${where}
         ORDER BY ul.detected_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(...params, limit, offset)
      .all()

    return c.json({
      updates: updates?.results || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (err) {
    console.error('Updates list error:', err)
    return c.json({ error: 'Failed to list updates' }, 500)
  }
})

// List all public projects (+ user's private projects if authenticated)
// Uses full-text search with relevance ranking
app.get('/projects', optionalAuthMiddleware, async (c) => {
  const userId = c.get('userId') as string | undefined

  const rawPage = parseInt(c.req.query('page') || '1', 10)
  const rawLimit = parseInt(c.req.query('limit') || '20', 10)
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20
  const offset = (page - 1) * limit

  const rawSearch = c.req.query('search') || ''
  if (rawSearch.length > 100) {
    return c.json({ error: 'Search term too long (max 100 characters)' }, 400)
  }

  try {
    const db = c.env.DB

    if (rawSearch) {
      // Use FTS for search queries
      const { results, total } = await searchProjects(db, rawSearch, limit, offset, userId)
      return c.json({
        projects: results,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        search: {
          query: rawSearch,
          relevance_ranked: true,
        },
      })
    } else {
      // No search: return recent projects
      if (userId) {
        const query =
          'SELECT p.*, u.username, u.avatar_url, pc.category FROM projects p JOIN users u ON p.user_id = u.id LEFT JOIN program_categories pc ON pc.project_id = p.id WHERE p.is_public = 1 OR p.user_id = ? ORDER BY p.updated_at DESC LIMIT ? OFFSET ?'
        const params = [userId, limit, offset]
        const countQuery = 'SELECT COUNT(*) as count FROM projects WHERE is_public = 1 OR user_id = ?'
        const countParams = [userId]

        const results = await db.prepare(query).bind(...params).all()
        const countResult = await db.prepare(countQuery).bind(...countParams).first()
        const total = (countResult as any)?.count || 0

        return c.json({
          projects: results?.results || [],
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        })
      } else {
        const query =
          'SELECT p.*, u.username, u.avatar_url, pc.category FROM projects p JOIN users u ON p.user_id = u.id LEFT JOIN program_categories pc ON pc.project_id = p.id WHERE p.is_public = 1 ORDER BY p.updated_at DESC LIMIT ? OFFSET ?'
        const params = [limit, offset]
        const countQuery = 'SELECT COUNT(*) as count FROM projects WHERE is_public = 1'

        const results = await db.prepare(query).bind(...params).all()
        const countResult = await db.prepare(countQuery).first()
        const total = (countResult as any)?.count || 0

        return c.json({
          projects: results?.results || [],
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        })
      }
    }
  } catch (err) {
    console.error('Projects list error:', err)
    return c.json({ error: 'Failed to list projects' }, 500)
  }
})

// Get user's own projects
app.get('/projects/mine', authMiddleware, async (c) => {
  const userId = c.get('userId') as string

  try {
    const db = c.env?.DB
    const results = await db
      ?.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(userId)
      .all()

    return c.json({ projects: results?.results || [] })
  } catch (err) {
    return c.json({ error: 'Failed to list projects' }, 500)
  }
})

// Get project by Solana program ID (auto-fetch from chain if not found)
app.get('/projects/by-program/:programId', optionalAuthMiddleware, async (c) => {
  const programId = c.req.param('programId')
  const userId = c.get('userId') as string | undefined

  try {
    const db = c.env?.DB

    // Look up by program_id (globally unique)
    const project = await db
      ?.prepare(
        'SELECT p.*, u.username, u.avatar_url FROM projects p LEFT JOIN users u ON p.user_id = u.id WHERE p.program_id = ?'
      )
      .bind(programId)
      .first()

    if (project) {
      // Check access
      if (!project.is_public && project.user_id !== userId) {
        return c.json({ error: 'Access denied' }, 403)
      }

      // Enrich with version, socials, owner info (same as GET /projects/:projectId)
      const [latestIdlResult, socialsResult] = await Promise.all([
        db
          ?.prepare(
            'SELECT id, version, created_at FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1'
          )
          .bind(project.id)
          .first(),
        db
          ?.prepare('SELECT twitter, discord, telegram, github, website FROM project_socials WHERE project_id = ?')
          .bind(project.id)
          .first(),
      ])

      let apiKeyCount = 0
      if (project.user_id === userId) {
        const keyCount = await db
          ?.prepare('SELECT COUNT(*) as count FROM api_keys WHERE project_id = ?')
          .bind(project.id)
          .first()
        apiKeyCount = (keyCount as any)?.count || 0
      }

      return c.json({
        project: {
          ...project,
          latestVersion: latestIdlResult?.version || 0,
          latestVersionDate: latestIdlResult?.created_at,
          socials: socialsResult || {},
          apiKeyCount,
          isOwner: project.user_id === userId,
        },
      })
    }

    // Not found in DB — try fetching IDL from Solana on-chain
    const rpcUrl = c.env?.SOLANA_MAINNET_RPC_URL || c.env?.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    const fetchResult = await fetchAnchorIDLFromChain(programId, rpcUrl)

    if (!fetchResult) {
      return c.json({ error: 'Program not found on-chain or does not have an Anchor IDL' }, 404)
    }

    // Auto-create "system" project
    const projectId = generateId()
    const now = getCurrentTimestamp()
    const idlName = fetchResult.idl.name || fetchResult.idl.metadata?.name || programId.slice(0, 8)

    await db
      ?.prepare(
        'INSERT INTO projects (id, user_id, name, description, program_id, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(projectId, 'system', idlName, `Auto-imported from Solana on-chain IDL`, programId, 1, now, now)
      .run()

    // Store IDL version
    const versionId = generateId()
    await db
      ?.prepare(
        'INSERT INTO idl_versions (id, project_id, idl_json, version, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(versionId, projectId, fetchResult.idlJson, 1, now)
      .run()

    // Auto-detect and seed category if known program
    await autoSeedCategory(db, projectId, idlName)

    // Cache IDL in KV
    const kv = c.env?.IDLS
    if (kv) {
      await kv.put(`idl:${projectId}:latest`, fetchResult.idlJson, { expirationTtl: 86400 * 30 })
    }
    // Generate and cache docs
    const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'
    const docs = generateDocumentation(fetchResult.idl, programId, apiBaseUrl, projectId, null)
    if (c.env?.CACHE) {
      await c.env.CACHE.put(`docs:${projectId}`, docs.full, { expirationTtl: 604800 })
    }
    try {
      await writeIdlSummaryCache({
        kv,
        projectId,
        programId,
        version: 1,
        idl: fetchResult.idl,
        docs,
      })
    } catch (err) {
      console.error('[api] Failed to cache IDL summary:', err)
    }

    return c.json({
      project: {
        id: projectId,
        user_id: 'system',
        name: idlName,
        description: 'Auto-imported from Solana on-chain IDL',
        program_id: programId,
        is_public: 1,
        created_at: now,
        updated_at: now,
        username: null,
        avatar_url: null,
        latestVersion: 1,
        latestVersionDate: now,
        socials: {},
        apiKeyCount: 0,
        isOwner: false,
      },
    })
  } catch (err) {
    return c.json({ error: 'Failed to look up program', details: (err as Error).message }, 500)
  }
})

// Get project details
app.get('/projects/:projectId', optionalAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string | undefined

  try {
    const db = c.env?.DB

    // Batch related queries for performance — single round-trip to D1
    const [projectResult, latestIdlResult, socialsResult] = await Promise.all([
      db
        ?.prepare(
          'SELECT p.*, u.username, u.avatar_url FROM projects p JOIN users u ON p.user_id = u.id WHERE p.id = ?'
        )
        .bind(projectId)
        .first(),
      db
        ?.prepare(
          'SELECT id, version, created_at FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1'
        )
        .bind(projectId)
        .first(),
      db
        ?.prepare('SELECT twitter, discord, telegram, github, website FROM project_socials WHERE project_id = ?')
        .bind(projectId)
        .first(),
    ])

    const project = projectResult

    if (!project) {
      return c.json({ error: 'Project not found' }, 404)
    }

    // Check access
    if (!project.is_public && project.user_id !== userId) {
      return c.json({ error: 'Access denied' }, 403)
    }

    // API key count only for owner (conditional query avoids unnecessary work)
    let apiKeyCount = 0
    if (project.user_id === userId) {
      const keyCount = await db
        ?.prepare('SELECT COUNT(*) as count FROM api_keys WHERE project_id = ?')
        .bind(projectId)
        .first()
      apiKeyCount = (keyCount as any)?.count || 0
    }

    return c.json({
      project: {
        ...project,
        latestVersion: latestIdlResult?.version || 0,
        latestVersionDate: latestIdlResult?.created_at,
        socials: socialsResult || {},
        apiKeyCount,
        isOwner: project.user_id === userId,
      },
    })
  } catch (err) {
    return c.json({ error: 'Failed to get project' }, 500)
  }
})

// Update project metadata
app.put('/projects/:projectId', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<{
      name?: string
      description?: string
      isPublic?: boolean
      socials?: {
        twitter?: string
        discord?: string
        telegram?: string
        github?: string
        website?: string
      }
    }>()

    const db = c.env?.DB

    // Check ownership
    const project = await db
      ?.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first()

    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    const now = getCurrentTimestamp()

    // Update project fields
    const updates: string[] = []
    const values: any[] = []

    if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name) }
    if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description) }
    if (body.isPublic !== undefined) { updates.push('is_public = ?'); values.push(body.isPublic ? 1 : 0) }
    updates.push('updated_at = ?')
    values.push(now)
    values.push(projectId)

    if (updates.length > 1) {
      await db?.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run()
    }

    // Update socials
    if (body.socials) {
      const s = body.socials
      await db
        ?.prepare(
          'UPDATE project_socials SET twitter = COALESCE(?, twitter), discord = COALESCE(?, discord), telegram = COALESCE(?, telegram), github = COALESCE(?, github), website = COALESCE(?, website), updated_at = ? WHERE project_id = ?'
        )
        .bind(s.twitter || null, s.discord || null, s.telegram || null, s.github || null, s.website || null, now, projectId)
        .run()
    }

    // Invalidate cached responses for this project
    await invalidateCache(c.env?.CACHE, [
      `api:/api/projects/${projectId}`,
      `api:/api/projects?`,
      `projects:`,
    ])

    return c.json({ message: 'Project updated', projectId })
  } catch (err) {
    return c.json({ error: 'Failed to update project' }, 500)
  }
})

// ── API Key Management ────────────────────────────────

// List API keys for project
app.get('/projects/:projectId/keys', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const db = c.env?.DB

    // Check ownership
    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    const keys = await db
      ?.prepare('SELECT id, key, last_used, created_at, expires_at FROM api_keys WHERE project_id = ?')
      .bind(projectId)
      .all()

    // Mask keys (show only last 8 chars)
    const maskedKeys = (keys?.results || []).map((k: any) => ({
      ...k,
      key: `${'*'.repeat(24)}${k.key.slice(-8)}`,
      fullKey: undefined,
    }))

    return c.json({ keys: maskedKeys })
  } catch (err) {
    return c.json({ error: 'Failed to list API keys' }, 500)
  }
})

// Create API key
app.post('/projects/:projectId/keys', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const body: { expiresInDays?: number } = await c.req.json<{ expiresInDays?: number }>().catch(() => ({}))

    const db = c.env?.DB

    // Check ownership
    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    // Generate API key
    const keyBytes = new Uint8Array(32)
    crypto.getRandomValues(keyBytes)
    const apiKey = `b58_${Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`

    const keyId = generateId()
    const now = getCurrentTimestamp()
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86400000).toISOString()
      : null

    await db
      ?.prepare(
        'INSERT INTO api_keys (id, project_id, key, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'
      )
      .bind(keyId, projectId, apiKey, now, expiresAt)
      .run()

    return c.json({
      id: keyId,
      key: apiKey, // Only shown once on creation
      createdAt: now,
      expiresAt,
      message: 'Store this key securely. It will not be shown again.',
    }, 201)
  } catch (err) {
    return c.json({ error: 'Failed to create API key' }, 500)
  }
})

// Delete API key
app.delete('/projects/:projectId/keys/:keyId', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const keyId = c.req.param('keyId')
  const userId = c.get('userId') as string

  try {
    const db = c.env?.DB

    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    await db?.prepare('DELETE FROM api_keys WHERE id = ? AND project_id = ?').bind(keyId, projectId).run()

    return c.json({ message: 'API key deleted' })
  } catch (err) {
    return c.json({ error: 'Failed to delete API key' }, 500)
  }
})

// Rotate API key
app.post('/projects/:projectId/keys/:keyId/rotate', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const keyId = c.req.param('keyId')
  const userId = c.get('userId') as string

  try {
    const db = c.env?.DB

    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    const existingKey = await db?.prepare('SELECT id FROM api_keys WHERE id = ? AND project_id = ?').bind(keyId, projectId).first()
    if (!existingKey) {
      return c.json({ error: 'API key not found' }, 404)
    }

    const keyBytes = new Uint8Array(32)
    crypto.getRandomValues(keyBytes)
    const newApiKey = `b58_${Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('')}`

    await db?.prepare('UPDATE api_keys SET key_value = ?, updated_at = ? WHERE id = ? AND project_id = ?')
      .bind(newApiKey, getCurrentTimestamp(), keyId, projectId)
      .run()

    return c.json({
      id: keyId,
      key: newApiKey,
      message: 'API key rotated successfully. Store the new key — it will not be shown again.'
    })
  } catch (err) {
    return c.json({ error: 'Failed to rotate API key' }, 500)
  }
})

// ── Public API Endpoints ────────────────────────────────

// Helper: Get project IDL
async function getProjectIDL(db: any, kv: any, projectId: string): Promise<{ idl: AnchorIDL; programId: string } | null> {
  // Try KV cache first
  if (kv) {
    const cached = await kv.get(`idl:${projectId}:latest`)
    if (cached) {
      const project = await db?.prepare('SELECT program_id FROM projects WHERE id = ?').bind(projectId).first()
      if (project) {
        return { idl: JSON.parse(cached), programId: project.program_id as string }
      }
    }
  }

  // Fall back to DB
  const result = await db
    ?.prepare(
      'SELECT iv.idl_json, iv.cpi_md, p.program_id FROM idl_versions iv JOIN projects p ON iv.project_id = p.id WHERE iv.project_id = ? AND (p.is_public = 1) ORDER BY iv.version DESC LIMIT 1'
    )
    .bind(projectId)
    .first()

  if (!result) return null

  return {
    idl: JSON.parse(result.idl_json as string),
    programId: result.program_id as string,
  }
}

// List instructions for project
app.get('/:projectId/instructions', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const summary = await getPublicIdlSummary({ db: c.env?.DB, kv: c.env?.IDLS, projectId })
    if (!summary) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    return c.json({
      projectId,
      programName: summary.programName,
      programId: summary.programId,
      instructions: summary.instructions,
    })
  } catch (err) {
    return c.json({ error: 'Failed to list instructions' }, 500)
  }
})

// Get specific instruction detail
app.get('/:projectId/instructions/:name', async (c) => {
  const projectId = c.req.param('projectId')
  const instructionName = c.req.param('name')

  try {
    const summary = await getPublicIdlSummary({ db: c.env?.DB, kv: c.env?.IDLS, projectId })
    if (!summary) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const instruction = getInstructionSummary(summary, instructionName)
    if (!instruction) {
      return c.json({ error: `Instruction "${instructionName}" not found` }, 404)
    }

    return c.json({
      projectId,
      programId: summary.programId,
      instruction,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get instruction' }, 500)
  }
})

// Build transaction
// Defaults: `network` omitted → mainnet-beta RPC for blockhash. For devnet programs always pass `network: "devnet"` or `rpcUrl`, or supply `recentBlockhash` from your RPC.
app.post('/:projectId/instructions/:name/build', buildRateLimit, async (c) => {
  const projectId = c.req.param('projectId')
  const instructionName = c.req.param('name')

  try {
    const body = await c.req.json<{
      accounts: Record<string, string>
      args: Record<string, any>
      feePayer: string
      recentBlockhash?: string
      /** Cluster name, or full https RPC URL (same rules as MCP build_instruction). */
      network?: string
      /** Overrides cluster-derived RPC when set (e.g. Helius URL with API key). */
      rpcUrl?: string
      /** Run simulateTransaction on the same RPC after building (no wallet). */
      simulate?: boolean
      /** Encoding for serializedTransaction in the response. Defaults to 'base58'. Use 'base64' for the modern Solana standard. */
      encoding?: 'base58' | 'base64'
    }>()

    if (!body.accounts || !body.args || !body.feePayer) {
      return c.json({ error: 'Missing required fields: accounts, args, feePayer' }, 400)
    }

    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const ix = getInstruction(data.idl, instructionName)
    if (!ix) {
      return c.json({ error: `Instruction "${instructionName}" not found` }, 404)
    }

    // Validate request
    const validation = validateBuildRequest(ix, body.accounts, body.args, data.idl.types)
    if (!validation.valid) {
      return c.json({ error: 'Invalid build request', details: validation.errors }, 400)
    }

    const { rpcUrl, cluster } = resolveSolanaRpcUrl({
      network: body.network ?? 'mainnet',
      rpcUrlOverride: body.rpcUrl,
      env: c.env,
    })

    const result = await buildTransaction(
      data.idl,
      instructionName,
      {
        accounts: body.accounts,
        args: body.args,
        feePayer: body.feePayer,
        recentBlockhash: body.recentBlockhash,
        simulate: body.simulate,
        encoding: body.encoding,
      },
      data.programId,
      rpcUrl,
      { cluster, rpcUrlHost: rpcUrlHost(rpcUrl) },
    )

    return c.json(result)
  } catch (err) {
    return c.json({ error: 'Failed to build transaction', details: (err as Error).message }, 500)
  }
})

// ── PDA Derivation ────────────────────────────────────

// List all PDA accounts and their seed requirements
app.get('/:projectId/pda', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const summary = await getPublicIdlSummary({ db: c.env?.DB, kv: c.env?.IDLS, projectId })
    if (!summary) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    return c.json({
      projectId,
      programId: summary.programId,
      pdaAccounts: summary.pdaAccounts,
    })
  } catch (err) {
    return c.json({ error: 'Failed to list PDA accounts', details: (err as Error).message }, 500)
  }
})

// Derive a PDA address
app.post('/:projectId/pda/derive', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const body = await c.req.json()
    const validation = validatePdaRequest(body)
    if (!validation.success) {
      return c.json({ error: 'Invalid PDA request', details: validation.errors }, 400)
    }

    const { instruction, account, seedValues } = validation.data!

    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    // ── Codama branch: derive from program.pdas by PDA name ──────────────────
    if (detectIDLFormat(data.idl as unknown) === 'codama') {
      const codamaIdl = data.idl as unknown as CodamaIDL
      // For Codama, `account` param holds the PDA name; `instruction` is unused
      const result = await deriveCodamaPda(codamaIdl, data.programId, account, seedValues)
      return c.json(result)
    }

    // ── Anchor branch ─────────────────────────────────────────────────────────
    const result = await derivePda(
      data.idl,
      data.programId,
      instruction,
      account,
      seedValues,
    )

    return c.json(result)
  } catch (err) {
    return c.json({ error: 'Failed to derive PDA', details: (err as Error).message }, 400)
  }
})

// Fetch and parse an on-chain account by address
app.get('/:projectId/pda/fetch/:address', async (c) => {
  const projectId = c.req.param('projectId')
  const address = c.req.param('address')
  const network = c.req.query('network') || 'mainnet-beta'

  // Basic address validation
  if (!address || address.length < 32 || address.length > 44) {
    return c.json({ error: 'Invalid address: must be a base58 public key (32-44 chars)' }, 400)
  }

  try {
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const { rpcUrl, cluster } = resolveSolanaRpcUrl({ network, env: c.env })

    let rawInfo
    try {
      rawInfo = await fetchAccountInfo(address, rpcUrl)
    } catch (rpcErr) {
      return c.json(
        { error: 'RPC request failed', details: (rpcErr as Error).message, rpcHost: rpcUrlHost(rpcUrl) },
        502,
      )
    }

    if (!rawInfo) {
      return c.json({ error: 'Account not found', address, cluster }, 404)
    }

    // Decode base64 account data
    const rawBytes = Uint8Array.from(atob(rawInfo.data), (c) => c.charCodeAt(0))

    let accountTypeName: string | null = null
    let parsedData: Record<string, unknown> | null = null
    let parseError: string | undefined

    if (detectIDLFormat(data.idl as unknown) === 'codama') {
      // ── Codama branch ───────────────────────────────────────────────────────
      const codamaIdl = data.idl as unknown as CodamaIDL
      const codamaAccDef = await detectCodamaAccountType(rawBytes, codamaIdl)
      if (codamaAccDef) {
        accountTypeName = codamaAccDef.name
        try {
          // Pass startOffset so size-discriminated accounts (offset=0) are decoded correctly
          parsedData = deserializeCodamaAccountData(rawBytes, codamaAccDef.data, codamaIdl, codamaAccDef.startOffset)
        } catch (parseErr) {
          parseError = (parseErr as Error).message
        }
      }
    } else {
      // ── Anchor branch ───────────────────────────────────────────────────────
      const accountDef = await detectAccountType(rawBytes, data.idl)
      if (accountDef) {
        accountTypeName = accountDef.name
        try {
          parsedData = deserializeAccountData(rawBytes, accountDef, data.idl)
        } catch (parseErr) {
          parseError = (parseErr as Error).message
        }
      }
    }

    return c.json({
      address,
      accountType: accountTypeName,
      programId: rawInfo.owner,
      lamports: rawInfo.lamports,
      executable: rawInfo.executable,
      rentEpoch: rawInfo.rentEpoch,
      cluster,
      slot: rawInfo.slot,
      data: parsedData,
      raw: rawInfo.data,
      ...(parseError ? { parseError } : {}),
    })
  } catch (err) {
    return c.json({ error: 'Failed to fetch account', details: (err as Error).message }, 500)
  }
})

// Query program-owned accounts with dataSize/memcmp filters and IDL decoding
app.post('/:projectId/program-accounts/query', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const body = await c.req.json<{
      accountType?: string
      network?: string
      rpcUrl?: string
      dataSize?: number
      memcmp?: Array<{ offset: number; bytes: string }>
      fieldFilters?: Array<{ field: string; bytes: string }>
      limit?: number
      paginationKey?: string
      changedSinceSlot?: number
      includeRaw?: boolean
    }>().catch(() => null)

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'Request body must be a JSON object' }, 400)
    }

    const errors: Array<{ field: string; message: string }> = []
    if (body.accountType !== undefined && (typeof body.accountType !== 'string' || body.accountType.trim().length === 0)) {
      errors.push({ field: 'accountType', message: 'accountType must be a non-empty string' })
    }
    if (body.dataSize !== undefined && (!Number.isInteger(body.dataSize) || body.dataSize <= 0)) {
      errors.push({ field: 'dataSize', message: 'dataSize must be a positive integer' })
    }
    if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit <= 0 || body.limit > 100)) {
      errors.push({ field: 'limit', message: 'limit must be an integer between 1 and 100' })
    }
    if (body.paginationKey !== undefined && (typeof body.paginationKey !== 'string' || body.paginationKey.length === 0)) {
      errors.push({ field: 'paginationKey', message: 'paginationKey must be a non-empty string' })
    }
    if (body.changedSinceSlot !== undefined && (!Number.isInteger(body.changedSinceSlot) || body.changedSinceSlot < 0)) {
      errors.push({ field: 'changedSinceSlot', message: 'changedSinceSlot must be a non-negative integer' })
    }
    if (body.memcmp !== undefined) {
      if (!Array.isArray(body.memcmp) || body.memcmp.length > 10) {
        errors.push({ field: 'memcmp', message: 'memcmp must be an array with at most 10 filters' })
      } else {
        body.memcmp.forEach((filter, index) => {
          if (!Number.isInteger(filter?.offset) || filter.offset < 0) {
            errors.push({ field: `memcmp.${index}.offset`, message: 'offset must be a non-negative integer' })
          }
          if (typeof filter?.bytes !== 'string' || filter.bytes.length === 0) {
            errors.push({ field: `memcmp.${index}.bytes`, message: 'bytes must be a non-empty string' })
          }
        })
      }
    }
    if (body.fieldFilters !== undefined) {
      if (!Array.isArray(body.fieldFilters) || body.fieldFilters.length > 10) {
        errors.push({ field: 'fieldFilters', message: 'fieldFilters must be an array with at most 10 filters' })
      } else {
        body.fieldFilters.forEach((filter, index) => {
          if (typeof filter?.field !== 'string' || filter.field.length === 0) {
            errors.push({ field: `fieldFilters.${index}.field`, message: 'field must be a non-empty string' })
          }
          if (typeof filter?.bytes !== 'string' || filter.bytes.length === 0) {
            errors.push({ field: `fieldFilters.${index}.bytes`, message: 'bytes must be a non-empty string' })
          }
        })
      }
    }
    if (body.includeRaw !== undefined && typeof body.includeRaw !== 'boolean') {
      errors.push({ field: 'includeRaw', message: 'includeRaw must be a boolean' })
    }
    if (!hasProgramAccountsSelector(body)) {
      errors.push({ field: 'filters', message: PROGRAM_ACCOUNTS_SELECTOR_ERROR })
    }

    if (errors.length > 0) {
      return c.json({ error: 'Invalid program account query', details: errors }, 400)
    }

    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const normalized = normalizeProgramAccountsQuery(body)
    const { rpcUrl, cluster } = resolveSolanaRpcUrl({
      network: normalized.network ?? 'mainnet-beta',
      rpcUrlOverride: normalized.rpcUrl,
      env: c.env,
    })

    const result = await queryProgramAccounts({
      idl: data.idl as AnchorIDL | CodamaIDL,
      programId: data.programId,
      rpcUrl,
      cluster,
      input: normalized,
    })

    return c.json({ projectId, ...result })
  } catch (err) {
    const message = (err as Error).message
    const isClientError =
      message.includes('not found in IDL') ||
      message.includes('fieldFilters require accountType') ||
      message.includes('not offset-resolvable')
    return c.json(
      { error: isClientError ? 'Invalid program account query' : 'Failed to query program accounts', details: message },
      isClientError ? 400 : 500,
    )
  }
})

// Get accounts
app.get('/:projectId/accounts', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const summary = await getPublicIdlSummary({ db: c.env?.DB, kv: c.env?.IDLS, projectId })
    if (!summary) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    return c.json({
      projectId,
      programName: summary.programName,
      accounts: summary.accounts,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get accounts' }, 500)
  }
})

// Get errors
app.get('/:projectId/errors', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const summary = await getPublicIdlSummary({ db: c.env?.DB, kv: c.env?.IDLS, projectId })
    if (!summary) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    return c.json({
      projectId,
      programName: summary.programName,
      errors: summary.errors,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get errors' }, 500)
  }
})

// Get events
app.get('/:projectId/events', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const summary = await getPublicIdlSummary({ db: c.env?.DB, kv: c.env?.IDLS, projectId })
    if (!summary) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    return c.json({
      projectId,
      programName: summary.programName,
      events: summary.events,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get events' }, 500)
  }
})

// Get types
app.get('/:projectId/types', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const summary = await getPublicIdlSummary({ db: c.env?.DB, kv: c.env?.IDLS, projectId })
    if (!summary) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    return c.json({
      projectId,
      programName: summary.programName,
      types: summary.types,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get types' }, 500)
  }
})

// Get documentation (Markdown)
app.get('/:projectId/docs', optionalAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string | undefined
  const format = c.req.query('format') || 'json'
  const refresh = c.req.query('refresh') === '1' || c.req.query('refresh') === 'true'

  try {
    const db = c.env?.DB

    // Check if project exists and is accessible
    const project = await db
      ?.prepare('SELECT custom_docs, program_id, is_public, user_id FROM projects WHERE id = ?')
      .bind(projectId)
      .first()

    if (!project) {
      return c.json({ error: 'Project not found' }, 404)
    }

    // Private projects are only visible to the owner
    if (!project.is_public && project.user_id !== userId) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    // If owner has custom docs, serve those
    if (project.custom_docs) {
      const customDocs = project.custom_docs as string
      if (format === 'md' || format === 'markdown') {
        return c.text(customDocs)
      }
      return c.json({ projectId, docs: customDocs, isCustom: true })
    }

    if (!refresh && project.is_public) {
      const summary = await readIdlSummaryCache({
        kv: c.env?.IDLS,
        projectId,
        programId: project.program_id as string,
      })
      if (summary?.docs) {
        if (format === 'md' || format === 'markdown') {
          return c.text(summary.docs.full)
        }
        return c.json({
          projectId,
          docs: summary.docs.full,
          isCustom: false,
          source: 'summary-cache',
          sections: {
            overview: summary.docs.overview,
            instructions: summary.docs.instructions,
            accounts: summary.docs.accounts,
            programAccounts: summary.docs.programAccounts,
            types: summary.docs.types,
            errors: summary.docs.errors,
            events: summary.docs.events,
          },
        })
      }
    }

    // Try cache first for auto-generated docs unless refresh is requested
    if (!refresh && c.env?.CACHE) {
      const cached = await c.env.CACHE.get(`docs:${projectId}`)
      if (cached) {
        if (format === 'md' || format === 'markdown') {
          return c.text(cached)
        }
        return c.json({ projectId, docs: cached, isCustom: false, source: 'cache' })
      }
    }

    const result = await db
      ?.prepare(
        'SELECT iv.idl_json, iv.cpi_md, iv.version, p.program_id, p.name FROM idl_versions iv JOIN projects p ON iv.project_id = p.id WHERE iv.project_id = ? ORDER BY iv.version DESC LIMIT 1'
      )
      .bind(projectId)
      .first()

    if (!result) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const idl = JSON.parse(result.idl_json as string) as AnchorIDL
    const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'
    const docs = generateDocumentation(
      idl,
      result.program_id as string,
      apiBaseUrl,
      projectId,
      result.cpi_md as string | null,
    )

    // Cache the result
    if (c.env?.CACHE) {
      await c.env.CACHE.put(`docs:${projectId}`, docs.full, { expirationTtl: 604800 })
    }
    if (project.is_public) {
      try {
        await writeIdlSummaryCache({
          kv: c.env?.IDLS,
          projectId,
          programId: result.program_id as string,
          version: (result as any).version as number | undefined,
          idl,
          docs,
        })
      } catch (err) {
        console.error('[api] Failed to cache IDL summary docs:', err)
      }
    }

    if (format === 'md' || format === 'markdown') {
      return c.text(docs.full)
    }

    return c.json({
      projectId,
      docs: docs.full,
      isCustom: false,
      sections: {
        overview: docs.overview,
        instructions: docs.instructions,
        accounts: docs.accounts,
        programAccounts: docs.programAccounts,
        types: docs.types,
        errors: docs.errors,
        events: docs.events,
      },
    })
  } catch (err) {
    return c.json({ error: 'Failed to get documentation' }, 500)
  }
})

// Update documentation (owner only)
app.put('/:projectId/docs', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<{ docs: string }>()

    if (!body.docs || typeof body.docs !== 'string') {
      return c.json({ error: 'Missing required field: docs (string)' }, 400)
    }

    if (body.docs.length > 1024 * 1024) {
      return c.json({ error: 'Documentation exceeds maximum size of 1MB' }, 400)
    }

    const db = c.env?.DB

    // Check ownership
    const project = await db
      ?.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first()

    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    const now = getCurrentTimestamp()
    await db
      ?.prepare('UPDATE projects SET custom_docs = ?, updated_at = ? WHERE id = ?')
      .bind(body.docs, now, projectId)
      .run()

    // Invalidate cache
    if (c.env?.CACHE) {
      await c.env.CACHE.delete(`docs:${projectId}`)
    }

    return c.json({ message: 'Documentation updated', projectId })
  } catch (err) {
    return c.json({ error: 'Failed to update documentation', details: (err as Error).message }, 500)
  }
})

// Reset documentation to auto-generated (owner only)
app.delete('/:projectId/docs', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const db = c.env?.DB

    const project = await db
      ?.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?')
      .bind(projectId, userId)
      .first()

    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    const now = getCurrentTimestamp()
    await db
      ?.prepare('UPDATE projects SET custom_docs = NULL, updated_at = ? WHERE id = ?')
      .bind(now, projectId)
      .run()

    // Invalidate cache
    if (c.env?.CACHE) {
      await c.env.CACHE.delete(`docs:${projectId}`)
    }

    return c.json({ message: 'Documentation reset to auto-generated', projectId })
  } catch (err) {
    return c.json({ error: 'Failed to reset documentation', details: (err as Error).message }, 500)
  }
})

// ── Known Addresses ────────────────────────────────

// List known addresses for a project
app.get('/:projectId/addresses', optionalAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string | undefined

  try {
    const db = c.env?.DB

    // Check project exists and is accessible
    const project = await db?.prepare('SELECT id, is_public, user_id FROM projects WHERE id = ?').bind(projectId).first()
    if (!project) {
      return c.json({ error: 'Project not found' }, 404)
    }

    // Private projects are only visible to the owner
    if (!project.is_public && project.user_id !== userId) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const results = await db
      ?.prepare('SELECT id, label, address, description, created_at FROM known_addresses WHERE project_id = ? ORDER BY created_at ASC')
      .bind(projectId)
      .all()

    return c.json({ projectId, addresses: results?.results || [] })
  } catch (err) {
    return c.json({ error: 'Failed to list known addresses' }, 500)
  }
})

// Add known address (owner only)
app.post('/:projectId/addresses', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<{ label: string; address: string; description?: string }>()

    if (!body.label || !body.address) {
      return c.json({ error: 'Missing required fields: label, address' }, 400)
    }

    // Basic validation: Solana addresses are 32-44 chars base58
    if (body.address.length < 32 || body.address.length > 44) {
      return c.json({ error: 'Invalid Solana address format' }, 400)
    }

    if (body.label.length > 100) {
      return c.json({ error: 'Label must be 100 characters or less' }, 400)
    }

    const db = c.env?.DB

    // Check ownership
    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    // Limit known addresses per project
    const countResult = await db?.prepare('SELECT COUNT(*) as count FROM known_addresses WHERE project_id = ?').bind(projectId).first()
    if ((countResult as any)?.count >= 50) {
      return c.json({ error: 'Maximum of 50 known addresses per project' }, 400)
    }

    const addressId = generateId()
    const now = getCurrentTimestamp()

    await db
      ?.prepare('INSERT INTO known_addresses (id, project_id, label, address, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(addressId, projectId, body.label, body.address, body.description || null, now, now)
      .run()

    return c.json({
      id: addressId,
      label: body.label,
      address: body.address,
      description: body.description || null,
      createdAt: now,
    }, 201)
  } catch (err) {
    return c.json({ error: 'Failed to add known address', details: (err as Error).message }, 500)
  }
})

// Update known address (owner only)
app.put('/:projectId/addresses/:addressId', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const addressId = c.req.param('addressId')
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<{ label?: string; address?: string; description?: string }>()

    const db = c.env?.DB

    // Check ownership
    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    if (body.address && (body.address.length < 32 || body.address.length > 44)) {
      return c.json({ error: 'Invalid Solana address format' }, 400)
    }

    const now = getCurrentTimestamp()
    const updates: string[] = []
    const values: any[] = []

    if (body.label !== undefined) { updates.push('label = ?'); values.push(body.label) }
    if (body.address !== undefined) { updates.push('address = ?'); values.push(body.address) }
    if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description) }
    updates.push('updated_at = ?')
    values.push(now)
    values.push(addressId)
    values.push(projectId)

    await db?.prepare(`UPDATE known_addresses SET ${updates.join(', ')} WHERE id = ? AND project_id = ?`).bind(...values).run()

    return c.json({ message: 'Address updated', addressId })
  } catch (err) {
    return c.json({ error: 'Failed to update address', details: (err as Error).message }, 500)
  }
})

// Delete known address (owner only)
app.delete('/:projectId/addresses/:addressId', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const addressId = c.req.param('addressId')
  const userId = c.get('userId') as string

  try {
    const db = c.env?.DB

    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    await db?.prepare('DELETE FROM known_addresses WHERE id = ? AND project_id = ?').bind(addressId, projectId).run()

    return c.json({ message: 'Address deleted' })
  } catch (err) {
    return c.json({ error: 'Failed to delete address' }, 500)
  }
})

// ── External API endpoint documentation ─────────────

// List owner-documented external API endpoints for a project
app.get('/:projectId/external-apis', optionalAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string | undefined

  try {
    const db = c.env?.DB

    const project = await db?.prepare('SELECT id, is_public, user_id FROM projects WHERE id = ?').bind(projectId).first()
    if (!project) {
      return c.json({ error: 'Project not found' }, 404)
    }

    if (!project.is_public && project.user_id !== userId) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const results = await db
      ?.prepare(
        'SELECT id, project_id, name, method, url, purpose, parameters_json, example_request, response_notes, auth_notes, created_at, updated_at FROM custom_api_endpoints WHERE project_id = ? ORDER BY created_at ASC'
      )
      .bind(projectId)
      .all()

    const endpoints = ((results?.results || []) as CustomApiRow[]).map(serializeCustomApiRow)
    return c.json({ projectId, endpoints })
  } catch (err) {
    return c.json({ error: 'Failed to list external API endpoints' }, 500)
  }
})

// Add external API endpoint documentation (owner only)
app.post('/:projectId/external-apis', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<CustomApiInput>()
    const validation = validateCustomApiInput(body)
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400)
    }

    const db = c.env?.DB

    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    const countResult = await db?.prepare('SELECT COUNT(*) as count FROM custom_api_endpoints WHERE project_id = ?').bind(projectId).first()
    if ((countResult as any)?.count >= 50) {
      return c.json({ error: 'Maximum of 50 external API endpoints per project' }, 400)
    }

    const endpointId = generateId()
    const now = getCurrentTimestamp()
    const data = validation.data

    await db
      ?.prepare(
        'INSERT INTO custom_api_endpoints (id, project_id, name, method, url, purpose, parameters_json, example_request, response_notes, auth_notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        endpointId,
        projectId,
        data.name!.trim(),
        data.method!,
        data.url!.trim(),
        data.purpose!.trim(),
        JSON.stringify(data.parameters || []),
        data.exampleRequest?.trim() || null,
        data.responseNotes?.trim() || null,
        data.authNotes?.trim() || null,
        now,
        now,
      )
      .run()

    return c.json({
      id: endpointId,
      project_id: projectId,
      name: data.name!.trim(),
      method: data.method,
      url: data.url!.trim(),
      purpose: data.purpose!.trim(),
      parameters: data.parameters || [],
      example_request: data.exampleRequest?.trim() || null,
      response_notes: data.responseNotes?.trim() || null,
      auth_notes: data.authNotes?.trim() || null,
      created_at: now,
      updated_at: now,
    }, 201)
  } catch (err) {
    return c.json({ error: 'Failed to add external API endpoint', details: (err as Error).message }, 500)
  }
})

// Update external API endpoint documentation (owner only)
app.put('/:projectId/external-apis/:endpointId', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const endpointId = c.req.param('endpointId')
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<CustomApiInput>()
    const validation = validateCustomApiInput(body, true)
    if (!validation.ok) {
      return c.json({ error: validation.error }, 400)
    }

    const db = c.env?.DB

    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    const data = validation.data
    const updates: string[] = []
    const values: any[] = []

    if (data.name !== undefined) { updates.push('name = ?'); values.push(data.name.trim()) }
    if (data.method !== undefined) { updates.push('method = ?'); values.push(data.method) }
    if (data.url !== undefined) { updates.push('url = ?'); values.push(data.url.trim()) }
    if (data.purpose !== undefined) { updates.push('purpose = ?'); values.push(data.purpose.trim()) }
    if (data.parameters !== undefined) { updates.push('parameters_json = ?'); values.push(JSON.stringify(data.parameters)) }
    if (data.exampleRequest !== undefined) { updates.push('example_request = ?'); values.push(data.exampleRequest.trim() || null) }
    if (data.responseNotes !== undefined) { updates.push('response_notes = ?'); values.push(data.responseNotes.trim() || null) }
    if (data.authNotes !== undefined) { updates.push('auth_notes = ?'); values.push(data.authNotes.trim() || null) }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400)
    }

    const now = getCurrentTimestamp()
    updates.push('updated_at = ?')
    values.push(now, endpointId, projectId)

    const result = await db
      ?.prepare(`UPDATE custom_api_endpoints SET ${updates.join(', ')} WHERE id = ? AND project_id = ?`)
      .bind(...values)
      .run()

    if ((result as any)?.meta?.changes === 0) {
      return c.json({ error: 'External API endpoint not found' }, 404)
    }

    return c.json({ message: 'External API endpoint updated', endpointId, updated_at: now })
  } catch (err) {
    return c.json({ error: 'Failed to update external API endpoint', details: (err as Error).message }, 500)
  }
})

// Delete external API endpoint documentation (owner only)
app.delete('/:projectId/external-apis/:endpointId', authMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const endpointId = c.req.param('endpointId')
  const userId = c.get('userId') as string

  try {
    const db = c.env?.DB

    const project = await db?.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
    if (!project) {
      return c.json({ error: 'Project not found or access denied' }, 404)
    }

    await db?.prepare('DELETE FROM custom_api_endpoints WHERE id = ? AND project_id = ?').bind(endpointId, projectId).run()

    return c.json({ message: 'External API endpoint deleted' })
  } catch (err) {
    return c.json({ error: 'Failed to delete external API endpoint' }, 500)
  }
})

// Get raw IDL
app.get('/:projectId/idl', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    return c.json({
      projectId,
      programId: data.programId,
      idl: data.idl,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get IDL' }, 500)
  }
})

/**
 * POST /tx/simulate
 * Simulate a raw pre-built Solana transaction (base64 or base58 wire bytes).
 * Useful for programs with custom discriminators that Orquestra cannot rebuild internally.
 * sigVerify is always false — no wallet or signature required.
 *
 * Body: { serializedTransaction: string, encoding?: 'base64'|'base58', network?: string, rpcUrl?: string }
 */
app.post('/tx/simulate', buildRateLimit, async (c) => {
  let body: { serializedTransaction?: string; encoding?: string; network?: string; rpcUrl?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  const { serializedTransaction, encoding = 'base64', network, rpcUrl: rpcUrlOverride } = body

  if (!serializedTransaction || typeof serializedTransaction !== 'string') {
    return c.json({ error: 'serializedTransaction (string) is required' }, 400)
  }
  if (encoding !== 'base64' && encoding !== 'base58') {
    return c.json({ error: 'encoding must be "base64" or "base58"' }, 400)
  }

  try {
    const { rpcUrl: resolvedRpc } = resolveSolanaRpcUrl({
      network: (network as any) ?? 'mainnet-beta',
      rpcUrlOverride,
      env: c.env,
    })

    const result = await simulateRawTransaction(serializedTransaction, encoding, resolvedRpc)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

export default app
