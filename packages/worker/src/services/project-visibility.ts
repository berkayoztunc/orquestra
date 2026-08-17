/**
 * One place that answers "may this caller see this project?".
 *
 * The `is_public` predicate used to be inlined at ~10 call sites in three
 * different shapes (404 public-only, 404 with an owner exception, 403), and
 * several IDL loaders checked it on their DB path but not on the KV-cache path
 * that ran first — so a cached private IDL was served to anyone. Routing every
 * loader through this helper is what makes that class of bug non-recurring.
 *
 * Two rules worth keeping in mind when calling it:
 *  - Call it BEFORE reading any cache. A visibility check after a cache hit is
 *    not a visibility check.
 *  - Callers should render a miss as 404, not 403 — 403 confirms the project
 *    exists, which is itself a disclosure.
 */

export interface VisibleProject {
  id: string
  program_id: string
  is_public: number
  user_id: string | null
}

/**
 * Returns the project row when it is public or owned by `userId`, else null.
 * `userId` is undefined for anonymous callers (see `optionalAuthMiddleware`).
 */
export async function getVisibleProject(
  db: any,
  projectId: string,
  userId?: string,
): Promise<VisibleProject | null> {
  const project = (await db
    ?.prepare('SELECT id, program_id, is_public, user_id FROM projects WHERE id = ?')
    .bind(projectId)
    .first()) as VisibleProject | null

  if (!project) return null
  if (!project.is_public && project.user_id !== userId) return null

  return project
}
