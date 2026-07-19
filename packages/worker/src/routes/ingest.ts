import { Hono } from 'hono'
import { ingestKeyMiddleware } from '../middleware/auth'
import { detectIDLFormat } from '../services/idl-parser'
import { autoSeedCategory } from '../services/program-auto-detect'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from '../services/ai-categorization'
import { setCategoryAndAliases } from '../services/search'
import { writeIdlSummaryCache } from '../services/idl-summary'
import { generateId } from '../utils/id'

function getCurrentTimestamp(): string {
  return new Date().toISOString()
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, '').replace(/-+/g, '-')
}

async function upsertProjectByProgramId(
  db: any,
  input: {
    projectId: string
    programId: string
    name: string
    description: string
    now: string
  },
): Promise<{ projectId: string; created: boolean }> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO projects (id, user_id, name, description, program_id, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(input.projectId, 'system', input.name, input.description, input.programId, 1, input.now, input.now)
    .run()

  const project = await db
    .prepare('SELECT id, name, description, program_id FROM projects WHERE program_id = ? LIMIT 1')
    .bind(input.programId)
    .first()

  if (!project?.id) {
    throw new Error(`Failed to upsert project for program ${input.programId}`)
  }

  const created = (project.id as string) === input.projectId

  if (!created) {
    await db
      .prepare(
        `UPDATE projects
         SET name = CASE
               WHEN name IS NULL OR name = '' OR name = program_id THEN ?
               ELSE name
             END,
             description = CASE
               WHEN (description IS NULL OR description = '') AND ? <> '' THEN ?
               ELSE description
             END,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.name, input.description, input.description, input.now, project.id)
      .run()
  }

  return { projectId: project.id as string, created }
}

type Env = {
  Variables: Record<string, unknown>
  Bindings: {
    DB: any
    IDLS: any
    CACHE: any
    AI: Ai
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
      idlSource?: 'pmp' | 'anchor'
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
      (body.idl.program && typeof body.idl.program.name === 'string' ? body.idl.program.name : null) || // Codama
      body.programId

    let programName = rawProgramName.trim() || body.programId
    let programDescription = body.programDescription || body.aiDescription || ''

    // ── 1. Find or create project ──────────────────────────────────
    let project = await db
      .prepare('SELECT id, name FROM projects WHERE program_id = ? LIMIT 1')
      .bind(body.programId)
      .first()

    let projectId: string
    let created = false

    if (!project) {
      let aiCategorizationResult:
        | Awaited<ReturnType<typeof categorizeProgramWithAI>>
        | null = null

      if (c.env?.AI) {
        try {
          aiCategorizationResult = await categorizeProgramWithAI(c.env.AI, {
            name: programName,
            description: programDescription,
            programId: body.programId,
            instructions: extractInstructionNames(body.idl),
            accounts: extractAccountNames(body.idl),
          })

          if (aiCategorizationResult.display_name) {
            programName = aiCategorizationResult.display_name
          }
          if (!programDescription && aiCategorizationResult.short_description) {
            programDescription = aiCategorizationResult.short_description
          }
        } catch (err) {
          console.error('[ingest] Synchronous AI categorization failed:', err)
        }
      }

      const proposedProjectId = generateId()
      const slug = slugify(programName)
      const upserted = await upsertProjectByProgramId(db, {
        projectId: proposedProjectId,
        programId: body.programId,
        name: programName,
        description: programDescription,
        now,
      })
      projectId = upserted.projectId

      // Create default socials entry
      const socials = await db
        .prepare('SELECT id FROM project_socials WHERE project_id = ? LIMIT 1')
        .bind(projectId)
        .first()
      if (!socials?.id) {
        await db
          .prepare('INSERT INTO project_socials (id, project_id, created_at, updated_at) VALUES (?, ?, ?, ?)')
          .bind(generateId(), projectId, now, now)
          .run()
      }

      // Auto-detect and seed category if known program
      await autoSeedCategory(db, projectId, programName)

      if (aiCategorizationResult) {
        try {
          await setCategoryAndAliases(
            db,
            projectId,
            aiCategorizationResult.category,
            aiCategorizationResult.tags,
            aiCategorizationResult.aliases,
          )
        } catch (err) {
          console.error('[ingest] Failed to save AI categorization result:', err)
        }
      }

      // Fire AI categorization in the background (non-blocking)
      if (c.env?.AI && !aiCategorizationResult) {
        c.executionCtx.waitUntil(
          (async () => {
            try {
              // Only run if autoSeedCategory didn't already set a category
              const existing = await db
                .prepare('SELECT id FROM program_categories WHERE project_id = ? LIMIT 1')
                .bind(projectId)
                .first()
              if (!existing) {
                const result = await categorizeProgramWithAI(c.env.AI, {
                  name: programName,
                  description: programDescription,
                  programId: body.programId,
                  instructions: extractInstructionNames(body.idl),
                  accounts: extractAccountNames(body.idl),
                })
                await setCategoryAndAliases(db, projectId, result.category, result.tags, result.aliases)
              }
            } catch (err) {
              console.error('[ingest] Background AI categorization failed:', err)
            }
          })()
        )
      }

      created = upserted.created
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
      const idlStandard = detectIDLFormat(body.idl)
      const idlSource = body.idlSource ?? 'anchor'
      await db
        .prepare(
          'INSERT INTO idl_versions (id, project_id, idl_json, idl_hash, version, created_at, idl_standard, idl_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(idlVersionId, projectId, idlStr, body.idlHash, nextVersion, now, idlStandard, idlSource)
        .run()

      // Cache in KV
      if (kv) {
        await kv.put(`idl:${projectId}:latest`, idlStr, { expirationTtl: 604800 })
        await kv.put(`idl:${projectId}:${nextVersion}`, idlStr, { expirationTtl: 604800 })
      }
      try {
        await writeIdlSummaryCache({
          kv,
          projectId,
          programId: body.programId,
          version: nextVersion,
          idl: body.idl as any,
        })
      } catch (err) {
        console.error('[ingest] Failed to cache IDL summary:', err)
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

// ── Program Discovery Queue ───────────────────────────────────────────────────

/**
 * POST /api/ingest/candidates
 *
 * Bulk-add Solana program IDs to the discovery queue (`program_candidates`).
 * The cron then checks each one for an on-chain IDL and auto-imports those
 * that have one; programs with no IDL are marked 'no_idl' and skipped forever.
 *
 * Auth: X-Ingest-Key
 * Body: { programIds: string[], source?: 'cli' | 'api' | 'manual' }
 * Returns: { queued: number, skipped: number }
 *   queued  — IDs submitted this request (may include already-queued ones)
 *   skipped — IDs that failed basic validation (not a 32-44 char base58 string)
 */
app.post('/candidates', ingestKeyMiddleware, async (c) => {
  try {
    const body = await c.req.json<{
      programIds: unknown
      source?: 'cli' | 'api' | 'manual'
    }>()

    if (!Array.isArray(body.programIds) || body.programIds.length === 0) {
      return c.json({ error: 'programIds must be a non-empty array' }, 400)
    }
    if (body.programIds.length > 5000) {
      return c.json({ error: 'Maximum 5000 program IDs per request' }, 400)
    }

    const db = c.env?.DB
    if (!db) return c.json({ error: 'Database not available' }, 500)

    const source = body.source ?? 'api'

    // Basic validation: Solana addresses are 32–44 base58 chars
    const valid: string[] = []
    let skipped = 0
    for (const id of body.programIds) {
      if (typeof id === 'string' && id.length >= 32 && id.length <= 44) {
        valid.push(id)
      } else {
        skipped++
      }
    }

    if (valid.length === 0) {
      return c.json({ queued: 0, skipped }, 400)
    }

    // INSERT OR IGNORE in bind-safe batches to avoid D1 variable limits.
    // Each row uses 3 bind vars: (program_id, status, source).
    // Keep a conservative ceiling to stay below environment-specific limits.
    const MAX_SQL_VARS = 90
    const ROWS_PER_INSERT = Math.max(1, Math.floor(MAX_SQL_VARS / 3))
    for (let i = 0; i < valid.length; i += ROWS_PER_INSERT) {
      const slice = valid.slice(i, i + ROWS_PER_INSERT)
      const placeholders = slice.map(() => '(?, ?, ?)').join(', ')
      const values = slice.flatMap((id) => [id, 'pending', source])
      await db
        .prepare(
          `INSERT OR IGNORE INTO program_candidates (program_id, status, source) VALUES ${placeholders}`,
        )
        .bind(...values)
        .run()
    }

    return c.json({ queued: valid.length, skipped })
  } catch (err) {
    console.error('[ingest/candidates] Error:', err)
    return c.json({ error: 'Failed to queue candidates', details: (err as Error).message }, 500)
  }
})

// ── Scan Metadata ─────────────────────────────────────────────────────────────

/**
 * POST /api/ingest/scan-metadata
 *
 * DEPRECATED as a scheduled path: previously called by the GitHub Actions
 * daily scan workflow (full getProgramAccounts sweep, ~500k programs/day)
 * after `cli:queue` completed. That cron is now disabled — ChainDiscoveryWorkflow
 * writes the same 'scan:metadata' KV shape directly (see chain-discovery-workflow.ts),
 * so this endpoint is kept only for the manual `workflow_dispatch` fallback in
 * daily-scan.yml.
 *
 * IMPORTANT semantic change: `programs_found` now means "new signatures/deploys
 * processed this run" (small, tens-low hundreds) when reported by the incremental
 * path, not the old full chain-wide program count (~500k). Don't be alarmed that
 * this number never reaches six figures again — that's the point of the change.
 *
 * Auth: X-Ingest-Key
 * Body: { programs_found: number, queued: number, skipped: number, rpc_url?: string }
 */
app.post('/scan-metadata', ingestKeyMiddleware, async (c) => {
  const cache = c.env?.CACHE
  if (!cache) return c.json({ error: 'Cache KV not available' }, 500)

  try {
    const body = await c.req.json<{
      programs_found: number
      queued: number
      skipped: number
      rpc_url?: string
    }>()

    const metadata = {
      programs_found: Number(body.programs_found ?? 0),
      queued: Number(body.queued ?? 0),
      skipped: Number(body.skipped ?? 0),
      scanned_at: new Date().toISOString(),
    }

    // Store for 8 days (scan runs daily; 8 days provides a comfortable safety margin)
    await cache.put('scan:metadata', JSON.stringify(metadata), { expirationTtl: 8 * 24 * 60 * 60 })

    return c.json({ ok: true, metadata })
  } catch (err) {
    console.error('[ingest/scan-metadata] Error:', err)
    return c.json({ error: 'Failed to store scan metadata', details: (err as Error).message }, 500)
  }
})

// ── Verified Build Metadata ─────────────────────────────────────────────────

/**
 * POST /api/ingest/verified-build-metadata
 *
 * Called by the CLI funnel after verified-build stage completes.
 * Stores latest verified-build counts in KV for the Sync dashboard.
 *
 * Auth: X-Ingest-Key
 * Body: { total_programs: number, verified_programs: number, verification_errors: number, source?: string }
 */
app.post('/verified-build-metadata', ingestKeyMiddleware, async (c) => {
  const cache = c.env?.CACHE
  if (!cache) return c.json({ error: 'Cache KV not available' }, 500)

  try {
    const body = await c.req.json<{
      total_programs: number
      verified_programs: number
      verification_errors: number
      source?: string
    }>()

    const metadata = {
      total_programs: Number(body.total_programs ?? 0),
      verified_programs: Number(body.verified_programs ?? 0),
      verification_errors: Number(body.verification_errors ?? 0),
      source: String(body.source || 'osec-verify'),
      scanned_at: new Date().toISOString(),
    }

    await cache.put('verified-build:metadata', JSON.stringify(metadata), {
      expirationTtl: 8 * 24 * 60 * 60,
    })

    return c.json({ ok: true, metadata })
  } catch (err) {
    console.error('[ingest/verified-build-metadata] Error:', err)
    return c.json({ error: 'Failed to store verified-build metadata', details: (err as Error).message }, 500)
  }
})

export default app
