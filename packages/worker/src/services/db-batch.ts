import type { D1Database } from '@cloudflare/workers-types'

/**
 * Which of `ids` already exist in `table.column`, checked in batches to stay
 * under D1's per-statement placeholder limit.
 */
export async function checkExistingIds(
  db: D1Database,
  table: string,
  column: string,
  ids: string[],
  batchSize = 100,
): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const ph = batch.map(() => '?').join(', ')
    const { results } = await db
      .prepare(`SELECT ${column} FROM ${table} WHERE ${column} IN (${ph})`)
      .bind(...batch)
      .all<Record<string, string>>()
    for (const r of results ?? []) found.add(r[column] as string)
  }
  return found
}
