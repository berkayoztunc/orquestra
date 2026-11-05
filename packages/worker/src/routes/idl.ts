import { Hono } from 'hono'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { invalidateCache } from '../middleware/cache'
import { uploadRateLimit } from '../middleware/rate-limit'
import { validateIDL, parseIDL, detectIDLFormat } from '../services/idl-parser'
import { generateDocumentation } from '../services/doc-generator'
import { validateIDLUpload } from '../services/validation'
import { autoSeedCategory } from '../services/program-auto-detect'
import { identifyProgram, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { generateAndStoreAIAnalysis } from '../services/ai-analysis'
import { deleteIdlSummaryCache, writeIdlSummaryCache } from '../services/idl-summary'
import { generateId } from '../utils/id'
import { getVisibleProject } from '../services/project-visibility'
import { aiBackgroundDisabled } from '../utils/ai-flags'
import { buildMainnetRpcUrlList } from '../utils/solana-rpc'
import { resolveIdlAgainstChain, checkOnChainIdl, type OnChainIdlCheck } from '../services/onchain-idl-check'
import { findSimilarName, idlOwnName } from '../services/name-similarity'
import { idlProvenance } from '../services/idl-provenance'
import { PublicKey } from '@solana/web3.js'

const MAX_IDL_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_CPI_SIZE = 5 * 1024 * 1024 // 5MB

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
    AI: Ai
    AI_BACKGROUND_DISABLED?: string
    API_BASE_URL: string
    AI_ANALYSIS_MODEL?: string
    HELIUS_API_KEY?: string
    SOLANA_RPC_URL?: string
    SOLANA_MAINNET_RPC_URL?: string
    SOLANA_FALLBACK_RPC_URLS?: string
    SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
  }
}

/** A Solana program ID is a canonical base58 string of exactly 32 bytes. */
function isValidProgramId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 32 || value.length > 44) return false
  try {
    return new PublicKey(value).toBase58() === value
  } catch {
    return false
  }
}

const app = new Hono<Env>()

// One-shot on-chain lookup for the upload flow: does this program already publish its own IDL?
// If so the client hides the manual upload and offers a chain import instead.
app.post('/check-program', uploadRateLimit, authMiddleware, async (c) => {
  try {
    const body = await c.req.json<{ programId?: string }>()
    if (!isValidProgramId(body.programId)) {
      return c.json({ error: 'programId must be a valid base58 Solana program address (32 bytes)' }, 400)
    }
    const programId = body.programId
    const check = await checkOnChainIdl(programId, buildMainnetRpcUrlList(c.env))
    if (check.status === 'error') {
      return c.json({ error: `Could not check the chain for an IDL (${check.message}). Please retry shortly.`, code: 'ONCHAIN_IDL_CHECK_FAILED' }, 503)
    }
    const existing = (await c.env?.DB
      ?.prepare('SELECT id, name FROM projects WHERE program_id = ? LIMIT 1')
      .bind(programId)
      .first()) as { id: string; name: string } | null | undefined
    const listed = existing ? { projectId: existing.id, name: existing.name } : null

    if (check.status === 'found') {
      const ixCount = Array.isArray(check.idl?.instructions) ? check.idl.instructions.length : (check.idl?.program?.instructions?.length ?? 0)
      return c.json({
        programId,
        status: 'found',
        source: check.source,
        name: idlOwnName(check.idl),
        instructionCount: ixCount,
        alreadyListed: listed,
      })
    }
    return c.json({ programId, status: check.status, alreadyListed: listed })
  } catch (err) {
    console.error('Check program error:', err)
    return c.json({ error: 'Failed to check program' }, 500)
  }
})

// Upload IDL - Creates a new project with IDL
app.post('/upload', uploadRateLimit, authMiddleware, async (c) => {
  const userId = c.get('userId') as string

  try {
    const body = await c.req.json<{
      /** Optional when the IDL is imported from the chain (defaults to the IDL's own name). */
      name?: string
      description?: string
      programId: string
      /** Omit to import the program's ON-CHAIN IDL; required for a manual upload. */
      idl?: any
      cpiMd?: string
      isPublic?: boolean
    }>()

    // Validate required fields
    if (!body.programId) {
      return c.json({ error: 'Missing required field: programId' }, 400)
    }
    if (!isValidProgramId(body.programId)) {
      return c.json({ error: 'programId must be a valid base58 Solana program address (32 bytes)' }, 400)
    }

    // One on-chain lookup per upload: reused below so the chain is asked only once.
    let chainCheck: OnChainIdlCheck | null = null
    if (!body.idl) {
      // Chain-import mode: no IDL file was sent, so the program's own on-chain IDL is the source.
      chainCheck = await checkOnChainIdl(body.programId, buildMainnetRpcUrlList(c.env))
      if (chainCheck.status === 'error') {
        return c.json({ error: `Could not check the chain for an IDL (${chainCheck.message}). Please retry shortly.`, code: 'ONCHAIN_IDL_CHECK_FAILED' }, 503)
      }
      if (chainCheck.status !== 'found') {
        return c.json({
          error: 'No readable on-chain IDL exists for this program. Publish the IDL on-chain, or upload the IDL file manually (it will be marked unverified).',
          code: 'ONCHAIN_IDL_NOT_FOUND',
        }, 400)
      }
      body.idl = chainCheck.idl
    }
    if (!body.name?.trim()) body.name = idlOwnName(body.idl) ?? ''
    if (!body.name) {
      return c.json({ error: 'Missing required field: name' }, 400)
    }

    // Validate IDL size
    let idlStr = JSON.stringify(body.idl)
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

    let parsed = parseIDL(body.idl)
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

    // Program IDs are first-come-first-served, so an uploaded IDL is only the uploader's claim.
    // The chain's own IDL (if any) wins; otherwise this is stored as a MANUAL IDL and flagged as such.
    const cached = chainCheck
    const resolved = await resolveIdlAgainstChain(
      body.programId,
      body.idl,
      buildMainnetRpcUrlList(c.env),
      cached ? async () => cached : checkOnChainIdl,
    )
    if (!resolved.ok) {
      return c.json({ error: resolved.message, code: 'ONCHAIN_IDL_CHECK_FAILED' }, 503)
    }
    const { idlSource, warnings: provenanceWarnings, onChain } = resolved.value

    // Manual uploads only: refuse names that are the same as, or a near-copy of, another public
    // project's name — the usual shape of an impersonation attempt on a well-known program.
    if (idlSource === 'manual') {
      const othersRes = await db
        ?.prepare('SELECT id, name, program_id FROM projects WHERE is_public = 1 AND program_id <> ?')
        .bind(body.programId)
        .all()
      const others = (othersRes?.results ?? []) as Array<{ id: string; name: string; program_id: string }>
      const clash = findSimilarName([body.name, idlOwnName(body.idl) ?? ''], others)
      if (clash) {
        return c.json({
          error: `This name is too similar to an existing project ("${clash.name}", program ${clash.program_id}). ` +
            'Manual uploads cannot reuse or imitate another project\'s name. Rename the project, or publish the IDL on-chain.',
          code: 'NAME_TOO_SIMILAR',
          similarTo: { projectId: clash.id, name: clash.name, programId: clash.program_id },
        }, 409)
      }
    }
    body.idl = resolved.value.idl
    idlStr = resolved.value.idlJson
    parsed = parseIDL(body.idl)

    // Create project
    await db
      ?.prepare(
        'INSERT INTO projects (id, user_id, name, description, program_id, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(projectId, userId, body.name, body.description || '', body.programId, body.isPublic !== false ? 1 : 0, now, now)
      .run()

    // Create IDL version
    const idlVersionId = generateId()
    const idlStandard = detectIDLFormat(body.idl)
    await db
      ?.prepare(
        'INSERT INTO idl_versions (id, project_id, idl_json, cpi_md, version, created_at, idl_standard, idl_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(idlVersionId, projectId, idlStr, body.cpiMd || null, 1, now, idlStandard, idlSource)
      .run()

    // Create default socials entry
    await db
      ?.prepare(
        'INSERT INTO project_socials (id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?)'
      )
      .bind(generateId(), projectId, now, now)
      .run()

    // Auto-detect and seed category if known program
    await autoSeedCategory(db, projectId, body.name)

    // Fire AI categorization in the background (non-blocking)
    if (c.env?.AI && !aiBackgroundDisabled(c.env)) {
      c.executionCtx.waitUntil(
        (async () => {
          try {
            const existing = await db
              ?.prepare('SELECT id FROM program_categories WHERE project_id = ? LIMIT 1')
              .bind(projectId)
              .first()
            if (!existing) {
              const result = await identifyProgram(c.env, {
                name: body.name as string,
                description: body.description,
                programId: body.programId,
                instructions: extractInstructionNames(body.idl),
                accounts: extractAccountNames(body.idl),
              })
              await setCategoryAndAliases(db, projectId, result.category, result.tags, result.aliases, {
                source: result.source,
                website: result.website,
                iconUrl: result.iconUrl,
                twitter: result.twitter,
                discord: result.discord,
              })
            }
          } catch (err) {
            console.error('[idl] Background AI categorization failed:', err)
          }
        })()
      )
    }

    // Cache IDL in KV — public projects only. A private IDL in this cache is
    // what let other read paths serve it without a visibility check.
    if (kv && body.isPublic !== false) {
      await kv.put(`idl:${projectId}:latest`, idlStr, { expirationTtl: 604800 }) // 7 days
      await kv.put(`idl:${projectId}:1`, idlStr, { expirationTtl: 604800 })
    }
    // Generate documentation and cache
    const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'
    const docs = generateDocumentation(body.idl, body.programId, apiBaseUrl, projectId, body.cpiMd)
    if (c.env?.CACHE) {
      await c.env.CACHE.put(`docs:${projectId}`, docs.full, { expirationTtl: 604800 })
      c.executionCtx?.waitUntil(
        invalidateCache(c.env.CACHE, [`api:/api/${projectId}/`, `api:/project/${projectId}/`])
      )
    }
    try {
      await writeIdlSummaryCache({
        kv: c.env?.IDLS,
        projectId,
        programId: body.programId,
        version: 1,
        idl: body.idl,
        docs,
      })
    } catch (err) {
      console.error('[idl] Failed to cache IDL summary:', err)
    }

    if (c.env?.AI && db && !aiBackgroundDisabled(c.env)) {
      c.executionCtx.waitUntil(
        generateAndStoreAIAnalysis({
          db,
          ai: c.env.AI,
          id: generateId(),
          projectId,
          idlVersionId,
          idl: body.idl,
          docsText: docs.full,
          programId: body.programId,
          projectName: body.name,
          model: c.env.AI_ANALYSIS_MODEL,
          now,
        }).catch((err) => {
          console.error('[idl] Background AI analysis failed:', err)
        }),
      )
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
      // How this IDL relates to the chain. `provenance.notice` is non-null for manual uploads
      // and MUST be shown to whoever uses the IDL; `warnings` explains what happened to this upload.
      provenance: idlProvenance(idlSource),
      onChainIdl: onChain,
      warnings: provenanceWarnings,
    }, 201)
  } catch (err) {
    console.error('IDL upload error:', err)
    return c.json({ error: 'Failed to upload IDL', details: (err as Error).message }, 500)
  }
})

// Get IDL by project
app.get('/:projectId', optionalAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId')
  const version = c.req.query('version')

  try {
    const db = c.env?.DB

    // Resolve visibility BEFORE the cache read. This route previously returned
    // the cached IDL on a bare key hit and never consulted `is_public`, so a
    // private project's IDL was readable by anyone holding its id — and the DB
    // fallback below re-warmed that cache entry for `getProjectIDL` to serve.
    const project = await getVisibleProject(db, projectId, c.get('userId') as string | undefined)
    if (!project) {
      return c.json({ error: 'IDL not found' }, 404)
    }

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

    // Update KV cache — public projects only, so a private IDL never lands in a
    // cache that other read paths consult.
    if (kv && project.is_public) {
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
app.get('/:projectId/versions', optionalAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId')

  try {
    const db = c.env?.DB

    const project = await getVisibleProject(db, projectId, c.get('userId') as string | undefined)
    if (!project) {
      return c.json({ error: 'Project not found' }, 404)
    }

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

    // Same rule as upload: the chain's IDL wins; otherwise this version is a MANUAL IDL.
    const resolved = await resolveIdlAgainstChain(project.program_id as string, body.idl, buildMainnetRpcUrlList(c.env))
    if (!resolved.ok) {
      return c.json({ error: resolved.message, code: 'ONCHAIN_IDL_CHECK_FAILED' }, 503)
    }
    const { idlSource, warnings: provenanceWarnings, onChain } = resolved.value
    body.idl = resolved.value.idl
    const parsed = parseIDL(body.idl)
    const idlStr = resolved.value.idlJson

    // Get next version number
    const lastVersion = await db
      ?.prepare('SELECT MAX(version) as max_version FROM idl_versions WHERE project_id = ?')
      .bind(projectId)
      .first()

    const newVersion = ((lastVersion as any)?.max_version || 0) + 1
    const idlVersionId = generateId()
    const now = getCurrentTimestamp()

    // Insert new version
    const idlStandard2 = detectIDLFormat(body.idl)
    await db
      ?.prepare(
        'INSERT INTO idl_versions (id, project_id, idl_json, cpi_md, version, created_at, idl_standard, idl_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(idlVersionId, projectId, idlStr, body.cpiMd || null, newVersion, now, idlStandard2, idlSource)
      .run()

    // Update project timestamp
    await db?.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').bind(now, projectId).run()

    // Update KV cache — public projects only (see the upload path above).
    // `project` is the ownership row loaded further up, so `is_public` is free here.
    const kv = c.env?.IDLS
    if (kv && project.is_public) {
      await kv.put(`idl:${projectId}:latest`, idlStr, { expirationTtl: 604800 })
      await kv.put(`idl:${projectId}:${newVersion}`, idlStr, { expirationTtl: 604800 })
    }
    // Regenerate docs
    const apiBaseUrl = c.env?.API_BASE_URL || 'http://localhost:8787'
    const docs = generateDocumentation(body.idl, project.program_id as string, apiBaseUrl, projectId, body.cpiMd)
    if (c.env?.CACHE) {
      await c.env.CACHE.put(`docs:${projectId}`, docs.full, { expirationTtl: 604800 })
      c.executionCtx?.waitUntil(
        invalidateCache(c.env.CACHE, [`api:/api/${projectId}/`, `api:/project/${projectId}/`])
      )
    }
    try {
      await writeIdlSummaryCache({
        kv,
        projectId,
        programId: project.program_id as string,
        version: newVersion,
        idl: body.idl,
        docs,
      })
    } catch (err) {
      console.error('[idl] Failed to cache IDL summary:', err)
    }

    if (c.env?.AI && db && !aiBackgroundDisabled(c.env)) {
      c.executionCtx.waitUntil(
        generateAndStoreAIAnalysis({
          db,
          ai: c.env.AI,
          id: generateId(),
          projectId,
          idlVersionId,
          idl: body.idl,
          docsText: docs.full,
          programId: project.program_id as string,
          projectName: project.name as string,
          model: c.env.AI_ANALYSIS_MODEL,
          now,
        }).catch((err) => {
          console.error('[idl] Background AI analysis failed:', err)
        }),
      )
    }

    return c.json({
      versionId: idlVersionId,
      version: newVersion,
      programName: parsed.programName,
      instructionCount: parsed.instructionCount,
      warnings: [...validation.warnings, ...provenanceWarnings],
      provenance: idlProvenance(idlSource),
      onChainIdl: onChain,
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

    const versions = await db
      ?.prepare('SELECT version FROM idl_versions WHERE project_id = ?')
      .bind(projectId)
      .all()

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
      await deleteIdlSummaryCache(kv, projectId)
      await Promise.all((versions?.results || []).map((row: any) => kv.delete(`idl-summary:${projectId}:${row.version}`)))
    }
    if (c.env?.CACHE) {
      await c.env.CACHE.delete(`docs:${projectId}`)
      c.executionCtx?.waitUntil(
        invalidateCache(c.env.CACHE, [`api:/api/${projectId}/`, `api:/project/${projectId}/`])
      )
    }

    return c.json({ message: 'Project and all associated data deleted', projectId })
  } catch (err) {
    return c.json({ error: 'Failed to delete project', details: (err as Error).message }, 500)
  }
})

export default app
