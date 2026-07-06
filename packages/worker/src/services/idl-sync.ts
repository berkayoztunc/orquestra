import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { fetchIdlWithSource } from './idl-fetcher'
import { categorizeProgramWithAI, extractInstructionNames, extractAccountNames } from './ai-categorization'
import { setCategoryAndAliases } from './search'
import { generateId } from '../utils/id'

export interface SyncEnv {
  DB: D1Database
  IDLS: KVNamespace
  CACHE: KVNamespace
  // Use `any` to avoid Ai type conflicts between @cloudflare/workers-types versions
  AI?: any
  SOLANA_RPC_URL: string
  SOLANA_MAINNET_RPC_URL?: string
}

interface ProjectRow {
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
 * We stop processing at 12 minutes and save a KV checkpoint so the next cron
 * run resumes exactly where we left off rather than restarting from scratch.
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
const MAX_AI_PER_RUN = 100

/** KV key storing the continuation cursor for partial runs */
const CHECKPOINT_KEY = 'sync:progress:cursor'

// ── Helpers ───────────────────────────────────────────────────────────────────

async function hashIdl(idlJson: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idlJson))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

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

async function syncProject(
  db: D1Database,
  cache: KVNamespace,
  rpcUrl: string,
  project: ProjectRow,
): Promise<SyncProjectResult> {
  const base = {
    projectId: project.id,
    programName: project.name,
    programId: project.program_id,
    idl: null,
    version: 0,
  }

  // Fetch on-chain IDL with per-program timeout guard.
  // null → no on-chain IDL or timeout → skip this program.
  let onChain: { idl: any; idlJson: string; source: 'pmp' | 'anchor' } | null
  try {
    onChain = await withTimeout(
      fetchIdlWithSource(project.program_id, rpcUrl),
      PROGRAM_TIMEOUT_MS,
    )
  } catch {
    return { ...base, status: 'skipped', isFirstVersion: false }
  }
  if (!onChain) return { ...base, status: 'skipped', isFirstVersion: false }

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

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Sync all public projects' on-chain IDLs. Called by:
 * - Scheduled cron (0 *\/6 * * *) via wrangler.toml
 * - POST /api/admin/sync/trigger (manual, admin-only)
 *
 * ## Cloudflare Workers time limits
 * Paid plan cron triggers allow up to 15 minutes of wall-clock time.
 * This function stops at 12 minutes and writes a checkpoint to KV so
 * the next invocation continues from the same position rather than
 * restarting. On a full cycle (all programs processed) the checkpoint
 * is cleared.
 *
 * ## Ordering
 * Projects are sorted by updated_at ASC so the least-recently-synced
 * programs are always processed first — ensuring eventual fairness even
 * when large registries can't be fully covered in a single run.
 */
export async function runDailyIdlSync(
  env: SyncEnv,
  trigger: 'cron' | 'manual' = 'cron',
): Promise<void> {
  const rpcUrl = env.SOLANA_MAINNET_RPC_URL || env.SOLANA_RPC_URL
  const wallStart = Date.now()

  // ── Checkpoint: resume from last saved position ───────────────────────────
  let startIndex = 0
  if (trigger === 'cron') {
    try {
      const checkpoint = await env.CACHE.get<{ index: number; ts: number }>(
        CHECKPOINT_KEY,
        'json',
      )
      // Only honour a checkpoint from within the last 24 hours
      if (checkpoint && Date.now() - checkpoint.ts < 24 * 60 * 60 * 1000) {
        startIndex = checkpoint.index
        console.log(`[idl-sync] Resuming from checkpoint index ${startIndex}`)
      }
    } catch {
      // KV read failure is non-fatal; start from 0
    }
  }

  // ── DB: record start of run ───────────────────────────────────────────────
  const runId = generateId()
  await env.DB
    .prepare(
      'INSERT INTO sync_runs (id, started_at, trigger, status) VALUES (?, CURRENT_TIMESTAMP, ?, ?)',
    )
    .bind(runId, trigger, 'running')
    .run()

  // ── Fetch all public projects (oldest-synced first) ───────────────────────
  const { results: allProjects } = await env.DB
    .prepare(
      'SELECT id, program_id, name FROM projects WHERE is_public = 1 ORDER BY updated_at ASC',
    )
    .all<ProjectRow>()

  if (!allProjects || allProjects.length === 0) {
    console.log('[idl-sync] No projects to sync')
    await env.DB
      .prepare(
        'UPDATE sync_runs SET completed_at = CURRENT_TIMESTAMP, status = ?, total_checked = 0, total_programs = 0 WHERE id = ?',
      )
      .bind('complete', runId)
      .run()
    return
  }

  const projects = allProjects.slice(startIndex)
  console.log(
    `[idl-sync] Syncing ${projects.length} of ${allProjects.length} projects` +
    (startIndex > 0 ? ` (resuming from index ${startIndex})` : '') +
    ` (trigger: ${trigger}, concurrency: ${CONCURRENCY})`,
  )

  let updated = 0
  let unchanged = 0
  let skipped = 0
  let errors = 0
  let aiCallCount = 0
  let processedCount = 0
  let timedOut = false

  // ── Main processing loop ──────────────────────────────────────────────────
  for (let i = 0; i < projects.length; i += CONCURRENCY) {
    // Wall-clock guard: stop before hitting the 15-minute Workers cron limit
    if (Date.now() - wallStart > MAX_RUNTIME_MS) {
      timedOut = true
      const globalIndex = startIndex + i
      try {
        await env.CACHE.put(
          CHECKPOINT_KEY,
          JSON.stringify({ index: globalIndex, ts: Date.now() }),
          { expirationTtl: 24 * 60 * 60 },
        )
        console.log(
          `[idl-sync] Wall-clock limit reached after ${Math.round((Date.now() - wallStart) / 1000)}s. ` +
          `Checkpoint saved at index ${globalIndex}. Next cron will continue from here.`,
        )
      } catch {
        console.error('[idl-sync] Failed to write checkpoint to KV')
      }
      break
    }

    const batch = projects.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((p) => syncProject(env.DB, env.CACHE, rpcUrl, p)),
    )

    for (const r of results) {
      processedCount++
      if (r.status === 'fulfilled') {
        const sr = r.value
        if (sr.status === 'updated') {
          updated++
          // Trigger AI categorization on first-ever IDL discovery, capped per run
          if (sr.isFirstVersion && env.AI && sr.idl && aiCallCount < MAX_AI_PER_RUN) {
            aiCallCount++
            try {
              const catResult = await categorizeProgramWithAI(env.AI, {
                name: sr.programName,
                description: null,
                programId: sr.programId,
                instructions: extractInstructionNames(sr.idl),
                accounts: extractAccountNames(sr.idl),
              })
              await setCategoryAndAliases(
                env.DB,
                sr.projectId,
                catResult.category,
                catResult.tags,
                catResult.aliases,
              )
            } catch (err) {
              console.error(`[idl-sync] AI categorization failed for ${sr.programId}:`, err)
            }
          }
        } else if (sr.status === 'unchanged') {
          unchanged++
        } else {
          skipped++
        }
      } else {
        errors++
        console.error('[idl-sync] batch error:', r.reason)
      }
    }
  }

  // ── Clear checkpoint on full completion ───────────────────────────────────
  if (!timedOut) {
    try {
      await env.CACHE.delete(CHECKPOINT_KEY)
    } catch {
      // Non-fatal
    }
  }

  // ── DB: mark run complete ─────────────────────────────────────────────────
  const finalStatus = timedOut ? 'partial' : 'complete'
  await env.DB
    .prepare(
      `UPDATE sync_runs
       SET completed_at  = CURRENT_TIMESTAMP,
           status        = ?,
           total_checked = ?,
           total_programs = ?,
           updated_count = ?,
           unchanged_count = ?,
           skipped_count = ?,
           error_count   = ?
       WHERE id = ?`,
    )
    .bind(
      finalStatus,
      processedCount,
      allProjects.length,
      updated,
      unchanged,
      skipped,
      errors,
      runId,
    )
    .run()

  const elapsed = Math.round((Date.now() - wallStart) / 1000)
  console.log(
    `[idl-sync] ${finalStatus} in ${elapsed}s — ` +
    `updated: ${updated}, unchanged: ${unchanged}, skipped: ${skipped}, errors: ${errors}` +
    (timedOut ? ` | partial: ${processedCount}/${allProjects.length} this run` : ''),
  )
}


