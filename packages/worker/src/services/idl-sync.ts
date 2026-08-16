import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { fetchIdlWithSource, hasProgramOwnedAnchorIdlAccount, getIdlAccountAddress, getAnchorIdlPdaAddress } from './idl-fetcher'
import { identifyProgram, extractInstructionNames, extractAccountNames, toTitleCase } from './ai-categorization'
import { setCategoryAndAliases } from './search'
import { generateId } from '../utils/id'
import { buildMainnetRpcUrlList, getSignaturesForAddress } from '../utils/solana-rpc'
import { hashIdl } from '../utils/crypto'
import { deriveIdlProgramName } from '../utils/idl-naming'

export interface SyncEnv {
  DB: D1Database
  IDLS: KVNamespace
  CACHE: KVNamespace
  // Use `any` to avoid Ai type conflicts between @cloudflare/workers-types versions
  AI?: any
  HELIUS_API_KEY?: string
  SOLANA_RPC_URL: string
  SOLANA_MAINNET_RPC_URL?: string
  SOLANA_FALLBACK_RPC_URLS?: string
  SOLANA_MAINNET_FALLBACK_RPC_URLS?: string
}

export interface ProjectRow {
  id: string
  program_id: string
  name: string
}

interface VersionRow {
  idl_hash: string | null
  version: number
}

/**
 * Cloudflare Workers cron triggers have a 15-minute wall-clock limit (paid plans).
 * processCandidates() stops at 12 minutes rather than risk being killed mid-batch.
 */
const MAX_RUNTIME_MS = 12 * 60 * 1000 // 12 minutes

/**
 * Per-program timeout: if fetchIdlWithSource takes longer than this we skip it
 * so one slow/unresponsive program cannot stall an entire batch.
 */
const PROGRAM_TIMEOUT_MS = 8_000 // 8 seconds

/**
 * Number of concurrent RPC calls per batch.
 * 20 is safe with a paid RPC endpoint (Helius, QuickNode, etc.).
 * Lower this to 5 if using a public RPC to avoid rate limiting.
 */
const CONCURRENCY = 20

/** Maximum AI categorization calls per sync run to avoid quota exhaustion */
const MAX_AI_PER_RUN = 300

/** How many pending candidates to verify + auto-import per regular cron run */
const CANDIDATES_PER_RUN = 3000

/** How many stale no_idl entries to recheck per run */
const NO_IDL_RECHECK_LIMIT = 500

/** Errors tolerated per candidate before it dead-letters to status 'failed' */
const MAX_CANDIDATE_ATTEMPTS = 5

/** Parallel workers for candidate verification/import */
const CANDIDATE_CONCURRENCY = 20

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout. Returns null if the timeout fires first.
 * Used to prevent a single slow RPC call from blocking an entire batch.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

// ── Core sync logic ───────────────────────────────────────────────────────────

interface SyncProjectResult {
  status: 'updated' | 'unchanged' | 'skipped'
  /** True when this is the very first IDL version stored for this project */
  isFirstVersion: boolean
  projectId: string
  /** The parsed IDL — only present when status === 'updated' */
  idl: any | null
  programName: string
  programId: string
  version: number
}

/**
 * Cheap pre-check: does either derived IDL account address (legacy
 * createWithSeed or Anchor >=0.30 PDA — mirrors the dual-check in
 * hasProgramOwnedAnchorIdlAccount) have any signature newer than `cursor`?
 * Used to skip the expensive fetchIdlWithSource() call when nothing has
 * touched the on-chain IDL account since the last full sync.
 */
async function hasIdlAccountActivitySince(
  programId: string,
  rpcUrls: string[],
  cursor: string,
): Promise<boolean> {
  const [oldAddress, newAddress] = await Promise.all([
    getIdlAccountAddress(programId),
    getAnchorIdlPdaAddress(programId),
  ])
  const [oldSigs, newSigs] = await Promise.all([
    getSignaturesForAddress(rpcUrls, oldAddress, { limit: 1, until: cursor }),
    getSignaturesForAddress(rpcUrls, newAddress, { limit: 1, until: cursor }),
  ])
  return oldSigs.length > 0 || newSigs.length > 0
}

/** Newest signature across both IDL account address styles — becomes the new cursor. */
async function latestIdlAccountSignature(programId: string, rpcUrls: string[]): Promise<string | null> {
  const [oldAddress, newAddress] = await Promise.all([
    getIdlAccountAddress(programId),
    getAnchorIdlPdaAddress(programId),
  ])
  const [oldSigs, newSigs] = await Promise.all([
    getSignaturesForAddress(rpcUrls, oldAddress, { limit: 1 }),
    getSignaturesForAddress(rpcUrls, newAddress, { limit: 1 }),
  ])
  const candidates = [...oldSigs, ...newSigs].sort((a, b) => b.slot - a.slot)
  return candidates[0]?.signature ?? null
}

async function syncProject(
  db: D1Database,
  cache: KVNamespace,
  rpcUrls: string[],
  project: ProjectRow,
): Promise<SyncProjectResult> {
  const base = {
    projectId: project.id,
    programName: project.name,
    programId: project.program_id,
    idl: null,
    version: 0,
  }

  // Cheap-check-first: skip the full IDL fetch when a cursor exists and
  // neither derived IDL account has new activity since it. Most programs
  // never touch their IDL account again after deploy — this avoids an
  // expensive fetchIdlWithSource() round trip for the common case.
  const cursorRow = await db
    .prepare('SELECT last_signature FROM project_idl_cursors WHERE project_id = ?')
    .bind(project.id)
    .first<{ last_signature: string | null }>()

  if (cursorRow?.last_signature) {
    try {
      const hasActivity = await withTimeout(
        hasIdlAccountActivitySince(project.program_id, rpcUrls, cursorRow.last_signature),
        PROGRAM_TIMEOUT_MS,
      )
      if (hasActivity === false) {
        await db
          .prepare('UPDATE project_idl_cursors SET checked_at = CURRENT_TIMESTAMP WHERE project_id = ?')
          .bind(project.id)
          .run()
        const latest = await db
          .prepare('SELECT version FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1')
          .bind(project.id)
          .first<{ version: number }>()
        return { ...base, status: 'unchanged', isFirstVersion: false, version: latest?.version ?? 0 }
      }
      // hasActivity === true or === null (timeout) → fall through to full fetch.
    } catch {
      // Cheap check failed (RPC error) — fall through to full fetch rather
      // than silently skip; the full fetch has its own error handling.
    }
  }

  // Fetch on-chain IDL with per-program timeout guard.
  // null → no on-chain IDL or timeout → skip this program.
  let onChain: { idl: any; idlJson: string; source: 'pmp' | 'anchor' } | null
  try {
    onChain = await withTimeout(
      fetchIdlWithSource(project.program_id, rpcUrls),
      PROGRAM_TIMEOUT_MS,
    )
  } catch {
    return { ...base, status: 'skipped', isFirstVersion: false }
  }
  if (!onChain) return { ...base, status: 'skipped', isFirstVersion: false }

  // Seed/update the cursor now that a full fetch happened — only 1 extra
  // light getSignaturesForAddress(limit:1) call, on changed projects only.
  try {
    const newCursor = await withTimeout(latestIdlAccountSignature(project.program_id, rpcUrls), PROGRAM_TIMEOUT_MS)
    if (newCursor) {
      await db
        .prepare(
          `INSERT INTO project_idl_cursors (project_id, last_signature, checked_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(project_id) DO UPDATE SET
             last_signature = excluded.last_signature,
             checked_at = CURRENT_TIMESTAMP`,
        )
        .bind(project.id, newCursor)
        .run()
    }
  } catch {
    // Cursor seeding is best-effort — a missing cursor just means the next
    // run does another full fetch, not a correctness issue.
  }

  const newHash = await hashIdl(onChain.idlJson)

  // Compare with latest stored version
  const latest = await db
    .prepare('SELECT idl_hash, version FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1')
    .bind(project.id)
    .first<VersionRow>()

  if (latest?.idl_hash === newHash) {
    return { ...base, status: 'unchanged', isFirstVersion: false, version: latest.version }
  }

  const oldVersion = latest?.version ?? null
  const newVersion = (latest?.version ?? 0) + 1
  const isFirstVersion = newVersion === 1

  // Insert new IDL version
  const versionId = generateId()
  await db
    .prepare(
      'INSERT INTO idl_versions (id, project_id, idl_json, idl_hash, version, idl_standard, idl_source) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(versionId, project.id, onChain.idlJson, newHash, newVersion, 'anchor', onChain.source)
    .run()

  // Log the change
  await db
    .prepare(
      'INSERT INTO update_logs (id, project_id, program_id, program_name, old_version, new_version, old_hash, new_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      generateId(),
      project.id,
      project.program_id,
      project.name,
      oldVersion,
      newVersion,
      latest?.idl_hash ?? null,
      newHash,
    )
    .run()

  // Bump project updated_at
  await db
    .prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(project.id)
    .run()

  // Invalidate KV caches
  await Promise.allSettled([
    cache.delete(`idl:${project.id}:latest`),
    cache.delete(`docs:${project.id}`),
  ])

  return { ...base, status: 'updated', isFirstVersion, idl: onChain.idl, version: newVersion }
}

// ── Phase 2: Auto-discover new programs from candidates queue ─────────────────

interface CandidateRow {
  program_id: string
}

async function upsertProjectByProgramId(
  db: D1Database,
  input: {
    projectId: string
    programId: string
    name: string
    description: string
  },
): Promise<{ projectId: string; created: boolean }> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO projects (id, user_id, name, description, program_id, is_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    )
    .bind(input.projectId, 'system', input.name, input.description, input.programId)
    .run()

  const project = await db
    .prepare('SELECT id, name, description, program_id FROM projects WHERE program_id = ? LIMIT 1')
    .bind(input.programId)
    .first<{ id: string; name: string | null; description: string | null; program_id: string }>()

  if (!project?.id) {
    throw new Error(`Failed to upsert project for program ${input.programId}`)
  }

  const created = project.id === input.projectId

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
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(input.name, input.description, input.description, project.id)
      .run()
  }

  return { projectId: project.id, created }
}

async function markCandidateNoIdl(db: D1Database, programId: string): Promise<void> {
  // Jittered recheck window (25-35 days) so a bulk import doesn't create a
  // thundering herd of simultaneous rechecks a month later.
  await db
    .prepare(
      "UPDATE program_candidates SET status = 'no_idl', last_checked_at = CURRENT_TIMESTAMP, recheck_after = datetime('now', '+' || (25 + abs(random()) % 11) || ' days') WHERE program_id = ?",
    )
    .bind(programId)
    .run()
}

async function markCandidateHasIdl(db: D1Database, programId: string): Promise<void> {
  await db
    .prepare(
      "UPDATE program_candidates SET status = 'has_idl', last_checked_at = CURRENT_TIMESTAMP, recheck_after = NULL WHERE program_id = ?",
    )
    .bind(programId)
    .run()
}

interface ProcessOneCandidateResult {
  checked: number
  imported: number
}

async function processOneCandidate(
  db: D1Database,
  rpcUrls: string[],
  ai: any,
  programId: string,
  aiCallCount: number,
  aiUsedRef: { value: number },
  heliusApiKey?: string,
): Promise<ProcessOneCandidateResult> {
  const onChain = await withTimeout(
    fetchIdlWithSource(programId, rpcUrls),
    PROGRAM_TIMEOUT_MS,
  )

  if (!onChain) {
    await markCandidateNoIdl(db, programId)
    return { checked: 1, imported: 0 }
  }

  // Only import when the IDL is Anchor-sourced and account ownership matches the program.
  const ownerCheck = await withTimeout(
    hasProgramOwnedAnchorIdlAccount(programId, rpcUrls),
    PROGRAM_TIMEOUT_MS,
  )
  const isVerifiedOwned = onChain.source === 'anchor' && ownerCheck === true

  if (!isVerifiedOwned) {
    await markCandidateNoIdl(db, programId)
    return { checked: 1, imported: 0 }
  }

  // On-chain IDL exists — check whether we already have this program
  const existing = await db
    .prepare('SELECT id FROM projects WHERE program_id = ? LIMIT 1')
    .bind(programId)
    .first<{ id: string }>()

  let imported = 0

  if (!existing) {
    // Derive raw name from IDL
    const rawName = deriveIdlProgramName(onChain.idl, programId)

    // Default to title-cased name; AI will override if available
    let projectName = toTitleCase(rawName)
    let projectDescription = ''

    const proposedProjectId = generateId()
    const idlHash = await hashIdl(onChain.idlJson)

    // AI categorization + name/description generation
    const canUseAi = ai && onChain.idl && (aiCallCount + aiUsedRef.value) < MAX_AI_PER_RUN
    if (canUseAi) {
      aiUsedRef.value++
      try {
        const catResult = await identifyProgram({ AI: ai, HELIUS_API_KEY: heliusApiKey }, {
          name: rawName,
          description: null,
          programId,
          instructions: extractInstructionNames(onChain.idl),
          accounts: extractAccountNames(onChain.idl),
        })
        // Use AI-generated display name + description
        if (catResult.display_name) projectName = catResult.display_name
        if (catResult.short_description) projectDescription = catResult.short_description

        const upserted = await upsertProjectByProgramId(db, {
          projectId: proposedProjectId,
          programId,
          name: projectName,
          description: projectDescription,
        })

        if (upserted.created) {
          await setCategoryAndAliases(db, upserted.projectId, catResult.category, catResult.tags, catResult.aliases, {
            source: catResult.source,
            website: catResult.website,
            iconUrl: catResult.iconUrl,
            twitter: catResult.twitter,
            discord: catResult.discord,
          })
        }
      } catch (err) {
        console.error(`[idl-sync] AI failed for candidate ${programId}:`, err)
        await upsertProjectByProgramId(db, {
          projectId: proposedProjectId,
          programId,
          name: projectName,
          description: '',
        })
      }
    } else {
      // No AI available — insert with title-cased name
      await upsertProjectByProgramId(db, {
        projectId: proposedProjectId,
        programId,
        name: projectName,
        description: '',
      })
    }

    const project = await db
      .prepare('SELECT id FROM projects WHERE program_id = ? LIMIT 1')
      .bind(programId)
      .first<{ id: string }>()

    if (!project?.id) {
      throw new Error(`Project missing after upsert for program ${programId}`)
    }

    await db
      .prepare(
        'INSERT INTO idl_versions (id, project_id, idl_json, idl_hash, version, idl_standard, idl_source) VALUES (?, ?, ?, ?, 1, ?, ?)',
      )
      .bind(generateId(), project.id, onChain.idlJson, idlHash, 'anchor', onChain.source)
      .run()

    const socials = await db
      .prepare('SELECT id FROM project_socials WHERE project_id = ? LIMIT 1')
      .bind(project.id)
      .first<{ id: string }>()

    if (!socials?.id) {
      await db
        .prepare(
          'INSERT INTO project_socials (id, project_id, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
        )
        .bind(generateId(), project.id)
        .run()
    }

    imported = 1
    console.log(`[idl-sync] Auto-imported: "${projectName}" (${programId})`)
  }
  // else: project already exists — Phase 1 keeps its IDL updated

  await markCandidateHasIdl(db, programId)
  return { checked: 1, imported }
}

/**
 * Process up to `limit` pending rows from `program_candidates`.
 * Also re-checks stale `no_idl` entries (recheck_after < now).
 *
 * For each candidate:
 *  - Call fetchIdlWithSource (with per-program timeout)
 *  - Accept only verified + program-owned Anchor IDLs
 *  - IDL found AND program not yet in projects:
 *      AI generates display_name + short_description → create project + idl_versions + project_socials → mark 'has_idl'
 *  - IDL found AND program already imported:
 *      Phase 1 handles future updates; just mark 'has_idl'
 *  - No IDL:
 *      mark 'no_idl', set recheck_after = +30 days
 */
export async function processCandidates(
  db: D1Database,
  rpcUrls: string[],
  ai: any,
  wallStart: number,
  aiCallCount: number,
  limit: number = CANDIDATES_PER_RUN,
  opts?: {
    /**
     * Full-sweep mode: recheck every no_idl candidate not yet checked since
     * this ISO timestamp, ignoring recheck_after. Used by the weekly
     * "all IDL" sweep — each processed row gets a fresh last_checked_at, so
     * repeated chunked calls walk the whole pool exactly once per sweep.
     */
    sweepBefore?: string
  },
  heliusApiKey?: string,
): Promise<{ checked: number; imported: number; aiCallsUsed: number }> {
  // Pending candidates + stale no_idl entries due for recheck
  const { results: pending } = await db
    .prepare(
      'SELECT program_id FROM program_candidates WHERE status = ? ORDER BY added_at ASC LIMIT ?',
    )
    .bind('pending', limit)
    .all<CandidateRow>()

  const { results: stale } = opts?.sweepBefore
    ? await db
        .prepare(
          `SELECT program_id FROM program_candidates
           WHERE status = 'no_idl' AND (last_checked_at IS NULL OR last_checked_at < ?)
           ORDER BY last_checked_at ASC LIMIT ?`,
        )
        .bind(opts.sweepBefore, limit)
        .all<CandidateRow>()
    : await db
        .prepare(
          `SELECT program_id FROM program_candidates
           WHERE status = 'no_idl' AND recheck_after IS NOT NULL AND recheck_after < datetime('now')
           ORDER BY recheck_after ASC LIMIT ?`,
        )
        .bind(NO_IDL_RECHECK_LIMIT)
        .all<CandidateRow>()

  // Reset stale no_idl back to pending so the loop below processes them normally
  for (const row of stale ?? []) {
    await db
      .prepare(
        "UPDATE program_candidates SET status = 'pending', recheck_after = NULL WHERE program_id = ?",
      )
      .bind(row.program_id)
      .run()
  }

  const candidates = [...(pending ?? []), ...(stale ?? [])]
  const uniqueProgramIds = [...new Set(candidates.map((c) => c.program_id))]

  if (uniqueProgramIds.length === 0) {
    return { checked: 0, imported: 0, aiCallsUsed: 0 }
  }

  let checked = 0
  let imported = 0
  const aiUsedRef = { value: 0 }

  let nextIndex = 0
  const workerCount = Math.min(CANDIDATE_CONCURRENCY, uniqueProgramIds.length)
  const workers = Array.from({ length: workerCount }, () => (async () => {
    while (true) {
      // Stop early if wall-clock limit is close
      if (Date.now() - wallStart > MAX_RUNTIME_MS) break

      const idx = nextIndex
      nextIndex += 1
      if (idx >= uniqueProgramIds.length) break

      const programId = uniqueProgramIds[idx]
      try {
        const result = await processOneCandidate(db, rpcUrls, ai, programId, aiCallCount, aiUsedRef, heliusApiKey)
        checked += result.checked
        imported += result.imported
      } catch (err) {
        console.error(`[idl-sync] Candidate processing failed for ${programId}:`, err)
        // Requeue with an attempt counter; after MAX_CANDIDATE_ATTEMPTS the
        // candidate dead-letters to 'failed' so it stops burning RPC calls.
        const message = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500)
        await db
          .prepare(
            `UPDATE program_candidates
             SET attempts = attempts + 1,
                 last_error = ?,
                 last_checked_at = CURRENT_TIMESTAMP,
                 status = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'pending' END
             WHERE program_id = ?`,
          )
          .bind(message, MAX_CANDIDATE_ATTEMPTS, programId)
          .run()
      }
    }
  })())

  await Promise.all(workers)

  return { checked, imported, aiCallsUsed: aiUsedRef.value }
}

// ── Public entry points ───────────────────────────────────────────────────────

export interface SyncBatchResult {
  updated: number
  unchanged: number
  skipped: number
  errors: number
  categorized: number
}

/**
 * Sync a batch of projects concurrently and return aggregate counts.
 * Used by IdlSyncWorkflow — each workflow step calls this for its slice.
 */
export async function syncProjectBatch(
  env: SyncEnv,
  projects: ProjectRow[],
): Promise<SyncBatchResult> {
  const rpcUrls = buildMainnetRpcUrlList(env)
  let updated = 0, unchanged = 0, skipped = 0, errors = 0, categorized = 0, aiCallCount = 0

  const results = await Promise.allSettled(
    projects.map((p) => syncProject(env.DB, env.CACHE, rpcUrls, p)),
  )

  for (const r of results) {
    if (r.status === 'rejected') { errors++; continue }
    const sr = r.value
    if (sr.status === 'updated') {
      updated++
      if (sr.isFirstVersion && env.AI && aiCallCount < 50 && sr.idl) {
        try {
          const instructions = extractInstructionNames(sr.idl)
          const accounts = extractAccountNames(sr.idl)
          const cat = await identifyProgram(env, {
            name: sr.programName,
            programId: sr.programId,
            instructions,
            accounts,
          })
          await setCategoryAndAliases(env.DB, sr.projectId, cat.category, cat.tags, cat.aliases, {
            source: cat.source,
            website: cat.website,
            iconUrl: cat.iconUrl,
            twitter: cat.twitter,
            discord: cat.discord,
          })
          aiCallCount++
          categorized++
        } catch { /* non-fatal */ }
      }
    } else if (sr.status === 'unchanged') {
      unchanged++
    } else {
      skipped++
    }
  }

  return { updated, unchanged, skipped, errors, categorized }
}


