import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { fetchAnchorIDLFromChain } from './idl-fetcher'
import { generateId } from '../utils/id'

interface SyncEnv {
  DB: D1Database
  IDLS: KVNamespace
  CACHE: KVNamespace
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

async function hashIdl(idlJson: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(idlJson))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function syncProject(db: D1Database, cache: KVNamespace, rpcUrl: string, project: ProjectRow): Promise<'updated' | 'unchanged' | 'skipped'> {
  // Fetch on-chain IDL — null means no on-chain IDL (manually uploaded), skip
  let onChain: { idl: any; idlJson: string } | null
  try {
    onChain = await fetchAnchorIDLFromChain(project.program_id, rpcUrl)
  } catch {
    return 'skipped'
  }
  if (!onChain) return 'skipped'

  const newHash = await hashIdl(onChain.idlJson)

  // Get latest stored version
  const latest = await db
    .prepare(
      'SELECT idl_hash, version FROM idl_versions WHERE project_id = ? ORDER BY version DESC LIMIT 1',
    )
    .bind(project.id)
    .first<VersionRow>()

  if (latest?.idl_hash === newHash) return 'unchanged'

  const oldVersion = latest?.version ?? null
  const newVersion = (latest?.version ?? 0) + 1

  // Insert new IDL version
  const versionId = generateId()
  await db
    .prepare(
      'INSERT INTO idl_versions (id, project_id, idl_json, idl_hash, version, idl_standard) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(versionId, project.id, onChain.idlJson, newHash, newVersion, 'anchor')
    .run()

  // Log the update
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

  // Update project updated_at
  await db
    .prepare('UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(project.id)
    .run()

  // Invalidate KV caches
  await Promise.allSettled([
    cache.delete(`idl:${project.id}:latest`),
    cache.delete(`docs:${project.id}`),
  ])

  return 'updated'
}

export async function runDailyIdlSync(env: SyncEnv): Promise<void> {
  const rpcUrl = env.SOLANA_MAINNET_RPC_URL || env.SOLANA_RPC_URL
  const CONCURRENCY = 5

  const { results: projects } = await env.DB
    .prepare('SELECT id, program_id, name FROM projects WHERE is_public = 1')
    .all<ProjectRow>()

  if (!projects || projects.length === 0) {
    console.log('[idl-sync] No projects to sync')
    return
  }

  console.log(`[idl-sync] Syncing ${projects.length} projects`)

  let updated = 0
  let unchanged = 0
  let skipped = 0

  // Process in batches of CONCURRENCY
  for (let i = 0; i < projects.length; i += CONCURRENCY) {
    const batch = projects.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((p) => syncProject(env.DB, env.CACHE, rpcUrl, p)),
    )
    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value === 'updated') updated++
        else if (r.value === 'unchanged') unchanged++
        else skipped++
      } else {
        skipped++
        console.error('[idl-sync] batch error:', r.reason)
      }
    }
  }

  console.log(`[idl-sync] Done — updated: ${updated}, unchanged: ${unchanged}, skipped: ${skipped}`)
}
