/**
 * Project IDL lookup — KV cache with D1 fallback.
 *
 * Same shape as the private `fetchIDL` helper in `routes/mcp.ts`, extracted so
 * non-MCP callers (the flow engine's `orquestra.build_instruction@1` node) can
 * reuse it without duplicating the KV-then-D1 lookup. `routes/mcp.ts` keeps its
 * own copy for now (untouched, to avoid risking that file's existing behavior) —
 * folding it onto this one is a reasonable follow-up, not done here.
 */

import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import type { AnchorIDL, CodamaIDL } from './idl-parser'
import { getVisibleProject } from './project-visibility'

export interface FetchedProjectIdl {
  idl: AnchorIDL | CodamaIDL
  programId: string
  projectName: string
}

export async function fetchProjectIdl(
  projectId: string,
  env: { DB: D1Database; IDLS: KVNamespace },
): Promise<FetchedProjectIdl | null> {
  // Visibility before the cache read — checking it only on the D1 fallback lets
  // a cached private IDL through unchecked. No caller identity here, so this
  // stays public-only.
  const project = await getVisibleProject(env.DB, projectId)
  if (!project) return null

  const cached = await env.IDLS?.get(`project:${projectId}`)
  if (cached) {
    try {
      const parsed = JSON.parse(cached)
      return {
        idl: parsed.idl,
        programId: parsed.programId ?? '',
        projectName: parsed.projectName ?? projectId,
      }
    } catch {
      // fall through to D1
    }
  }

  const row = await env.DB.prepare(
    `SELECT p.name, p.program_id, v.idl_json
     FROM projects p
     JOIN idl_versions v ON v.project_id = p.id
     WHERE p.id = ?
     ORDER BY v.version DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{ name: string; program_id: string; idl_json: string }>()

  if (!row) return null

  try {
    const idl = JSON.parse(row.idl_json) as AnchorIDL | CodamaIDL
    return { idl, programId: row.program_id, projectName: row.name }
  } catch {
    return null
  }
}
