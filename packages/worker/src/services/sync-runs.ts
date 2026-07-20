import type { D1Database } from '@cloudflare/workers-types'

/**
 * Mark a `sync_runs` row failed so it never gets stuck at status='running'
 * when a workflow instance errors out mid-run. Each caller has a different
 * set of progress columns to persist alongside the failure — pass whatever
 * was accumulated so far as `counts`.
 */
export async function finalizeSyncRunFailed(
  db: D1Database,
  runId: string,
  counts: Record<string, number> = {},
  opts: { requireRunning?: boolean } = {},
): Promise<void> {
  const cols = Object.keys(counts)
  const setClause = ['completed_at = CURRENT_TIMESTAMP', "status = 'failed'", ...cols.map((c) => `${c} = ?`)].join(', ')
  const where = opts.requireRunning ? "WHERE id = ? AND status = 'running'" : 'WHERE id = ?'
  await db
    .prepare(`UPDATE sync_runs SET ${setClause} ${where}`)
    .bind(...cols.map((c) => counts[c]), runId)
    .run()
}
