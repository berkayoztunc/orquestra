import { Hono } from 'hono'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { buildRateLimit } from '../middleware/rate-limit'
import { invalidateCache } from '../middleware/cache'
import { parseIDL, getInstruction, resolveType, getDefaultValue, expandInstructionArgs, getDefinedTypeName, resolveDefinedType, resolveAccountFields, resolveEventFields, normalizeAccountMeta } from '../services/idl-parser'
import type { AnchorIDL } from '../services/idl-parser'
import { buildTransaction, validateBuildRequest } from '../services/tx-builder'
import { listPdaAccounts, derivePda } from '../services/pda'
import { generateDocumentation } from '../services/doc-generator'
import { validateProjectInput, validateBuildRequest as validateBuildInput, validatePdaRequest } from '../services/validation'

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
    SOLANA_RPC_URL: string
    SOLANA_MAINNET_RPC_URL?: string
    SOLANA_DEVNET_RPC_URL?: string
    API_BASE_URL: string
  }
}

const app = new Hono<Env>()

// ── Project Management ────────────────────────────────

// List all public projects (+ user's private projects if authenticated)
app.get('/projects', optionalAuthMiddleware, async (c) => {
  const userId = c.get('userId') as string | undefined
  const page = parseInt(c.req.query('page') || '1')
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
  const offset = (page - 1) * limit
  const search = c.req.query('search') || ''

  try {
    const db = c.env?.DB
    let query: string
    let countQuery: string
    const params: any[] = []
    const countParams: any[] = []

    if (search) {
      const searchTerm = `%${search}%`
      if (userId) {
        query = 'SELECT p.*, u.username, u.avatar_url FROM projects p JOIN users u ON p.user_id = u.id WHERE (p.is_public = 1 OR p.user_id = ?) AND (p.name LIKE ? OR p.description LIKE ?) ORDER BY p.updated_at DESC LIMIT ? OFFSET ?'
        params.push(userId, searchTerm, searchTerm, limit, offset)
        countQuery = 'SELECT COUNT(*) as count FROM projects WHERE (is_public = 1 OR user_id = ?) AND (name LIKE ? OR description LIKE ?)'
        countParams.push(userId, searchTerm, searchTerm)
      } else {
        query = 'SELECT p.*, u.username, u.avatar_url FROM projects p JOIN users u ON p.user_id = u.id WHERE p.is_public = 1 AND (p.name LIKE ? OR p.description LIKE ?) ORDER BY p.updated_at DESC LIMIT ? OFFSET ?'
        params.push(searchTerm, searchTerm, limit, offset)
        countQuery = 'SELECT COUNT(*) as count FROM projects WHERE is_public = 1 AND (name LIKE ? OR description LIKE ?)'
        countParams.push(searchTerm, searchTerm)
      }
    } else {
      if (userId) {
        query = 'SELECT p.*, u.username, u.avatar_url FROM projects p JOIN users u ON p.user_id = u.id WHERE p.is_public = 1 OR p.user_id = ? ORDER BY p.updated_at DESC LIMIT ? OFFSET ?'
        params.push(userId, limit, offset)
        countQuery = 'SELECT COUNT(*) as count FROM projects WHERE is_public = 1 OR user_id = ?'
        countParams.push(userId)
      } else {
        query = 'SELECT p.*, u.username, u.avatar_url FROM projects p JOIN users u ON p.user_id = u.id WHERE p.is_public = 1 ORDER BY p.updated_at DESC LIMIT ? OFFSET ?'
        params.push(limit, offset)
        countQuery = 'SELECT COUNT(*) as count FROM projects WHERE is_public = 1'
      }
    }

    const results = await db?.prepare(query).bind(...params).all()
    const countResult = await db?.prepare(countQuery).bind(...countParams).first()
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
  } catch (err) {
    return c.json({ error: 'Failed to list projects', details: (err as Error).message }, 500)
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
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const instructions = data.idl.instructions.map((ix) => ({
      name: ix.name,
      docs: Array.isArray(ix.docs) ? ix.docs.filter((d) => typeof d === 'string') : [],
      accountCount: ix.accounts?.length || 0,
      argCount: ix.args?.length || 0,
      accounts: ix.accounts.map((a) => {
        const norm = normalizeAccountMeta(a)
        return {
          name: norm.name,
          isMut: norm.isMut,
          isSigner: norm.isSigner,
          isOptional: norm.isOptional,
        }
      }),
      args: expandInstructionArgs(data.idl, ix.args).map((a) => ({
        name: a.name,
        type: a.typeStr,
        isDefinedType: a.isDefinedType,
        definedTypeName: a.definedTypeName,
        fields: a.fields ? a.fields.map((f) => ({
          name: f.name,
          type: f.typeStr,
          isDefinedType: f.isDefinedType,
          nestedFields: f.nestedFields,
        })) : null,
      })),
    }))

    return c.json({
      projectId,
      programName: data.idl.name,
      programId: data.programId,
      instructions,
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
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const ix = getInstruction(data.idl, instructionName)
    if (!ix) {
      return c.json({ error: `Instruction "${instructionName}" not found` }, 404)
    }

    return c.json({
      projectId,
      programId: data.programId,
      instruction: {
        name: ix.name,
        docs: Array.isArray(ix.docs) ? ix.docs.filter((d) => typeof d === 'string') : [],
        accounts: ix.accounts.map((a) => {
          const norm = normalizeAccountMeta(a)
          return {
            name: norm.name,
            isMut: norm.isMut,
            isSigner: norm.isSigner,
            isOptional: norm.isOptional,
            pda: a.pda || null,
          }
        }),
        args: expandInstructionArgs(data.idl, ix.args).map((a) => ({
          name: a.name,
          type: a.typeStr,
          defaultValue: getDefaultValue(a.type, data.idl),
          isDefinedType: a.isDefinedType,
          definedTypeName: a.definedTypeName,
          fields: a.fields ? a.fields.map((f) => ({
            name: f.name,
            type: f.typeStr,
            isDefinedType: f.isDefinedType,
            nestedFields: f.nestedFields,
          })) : null,
        })),
      },
    })
  } catch (err) {
    return c.json({ error: 'Failed to get instruction' }, 500)
  }
})

// Build transaction
app.post('/:projectId/instructions/:name/build', buildRateLimit, async (c) => {
  const projectId = c.req.param('projectId')
  const instructionName = c.req.param('name')

  try {
    const body = await c.req.json<{
      accounts: Record<string, string>
      args: Record<string, any>
      feePayer: string
      recentBlockhash?: string
      network?: string
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

    // Determine RPC URL:
    // 1. network = "devnet" → env SOLANA_DEVNET_RPC_URL or public devnet
    // 2. network = "mainnet" or not provided → env SOLANA_MAINNET_RPC_URL or SOLANA_RPC_URL or public mainnet
    // 3. network = anything else (URL) → use it directly as custom RPC
    let rpcUrl: string
    const network = body.network?.toLowerCase() || 'mainnet'
    
    if (network === 'devnet') {
      rpcUrl = c.env?.SOLANA_DEVNET_RPC_URL || 'https://api.devnet.solana.com'
    } else if (network === 'mainnet' || network === 'mainnet-beta') {
      rpcUrl = c.env?.SOLANA_MAINNET_RPC_URL || c.env?.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    } else {
      // Treat as custom RPC URL
      rpcUrl = body.network!
    }

    const result = await buildTransaction(
      data.idl,
      instructionName,
      {
        accounts: body.accounts,
        args: body.args,
        feePayer: body.feePayer,
        recentBlockhash: body.recentBlockhash,
      },
      data.programId,
      rpcUrl,
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
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const pdaAccounts = listPdaAccounts(data.idl)

    return c.json({
      projectId,
      programId: data.programId,
      pdaAccounts,
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

// Get accounts
app.get('/:projectId/accounts', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const accounts = (data.idl.accounts || []).map((acc) => {
      const resolved = resolveAccountFields(data.idl, acc)
      return {
        name: acc.name,
        kind: resolved.kind,
        docs: acc.docs || [],
        discriminator: acc.discriminator || [],
        fields: resolved.fields.map((f) => ({
          name: f.name,
          type: f.typeStr,
        })),
      }
    })

    return c.json({
      projectId,
      programName: data.idl.name,
      accounts,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get accounts' }, 500)
  }
})

// Get errors
app.get('/:projectId/errors', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    return c.json({
      projectId,
      programName: data.idl.name,
      errors: data.idl.errors || [],
    })
  } catch (err) {
    return c.json({ error: 'Failed to get errors' }, 500)
  }
})

// Get events
app.get('/:projectId/events', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const events = (data.idl.events || []).map((event) => {
      const resolved = resolveEventFields(data.idl, event)
      return {
        name: event.name,
        discriminator: event.discriminator || [],
        fields: resolved.fields.map((f) => ({
          name: f.name,
          type: f.typeStr,
        })),
      }
    })

    return c.json({
      projectId,
      programName: data.idl.name,
      events,
    })
  } catch (err) {
    return c.json({ error: 'Failed to get events' }, 500)
  }
})

// Get types
app.get('/:projectId/types', async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const data = await getProjectIDL(c.env?.DB, c.env?.IDLS, projectId)
    if (!data) {
      return c.json({ error: 'Project not found or not public' }, 404)
    }

    const types = (data.idl.types || []).map((t) => ({
      name: t.name,
      kind: t.type?.kind || 'unknown',
      fields: (t.type?.fields || []).map((f) => ({
        name: f.name,
        type: resolveType(f.type),
      })),
    }))

    return c.json({
      projectId,
      programName: data.idl.name,
      types,
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

    // Try cache first for auto-generated docs
    if (c.env?.CACHE) {
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
        'SELECT iv.idl_json, iv.cpi_md, p.program_id, p.name FROM idl_versions iv JOIN projects p ON iv.project_id = p.id WHERE iv.project_id = ? ORDER BY iv.version DESC LIMIT 1'
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

export default app
