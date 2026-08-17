/**
 * Removal of a project's cached IDL from KV.
 *
 * Needed in two places: when a project is flipped to private (the cache would
 * otherwise keep answering public read paths until its 7-day TTL lapses), and
 * for the one-time purge of entries written before visibility was enforced on
 * the cache-read paths.
 *
 * The keys mirror every writer in the app: `idl:<projectId>:latest`,
 * `idl:<projectId>:<version>` for each row in `idl_versions`, and the
 * `project:<projectId>` key read by `idl-fetch`/`idl-registry`.
 */

export async function deleteProjectIdlCache(kv: any, db: any, projectId: string): Promise<number> {
  if (!kv) return 0

  const keys = [`idl:${projectId}:latest`, `project:${projectId}`]

  const versions = await db
    ?.prepare('SELECT version FROM idl_versions WHERE project_id = ?')
    .bind(projectId)
    .all()

  for (const row of (versions?.results ?? []) as Array<{ version: number }>) {
    keys.push(`idl:${projectId}:${row.version}`)
  }

  await Promise.all(keys.map((key) => kv.delete(key).catch(() => undefined)))
  return keys.length
}
