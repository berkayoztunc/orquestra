import type { D1Database } from '@cloudflare/workers-types'

/** Enqueue newly-discovered program ids into `program_candidates`, tagged by discovery source. */
export async function enqueueCandidates(db: D1Database, programIds: string[], source: string): Promise<number> {
  let inserted = 0
  for (const programId of programIds) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO program_candidates (program_id, status, source, added_at)
         VALUES (?, 'pending', ?, CURRENT_TIMESTAMP)`,
      )
      .bind(programId, source)
      .run()
    inserted += result?.meta?.changes ?? 0
  }
  return inserted
}
