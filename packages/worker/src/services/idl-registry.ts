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

export interface FetchedProjectIdl {
  idl: AnchorIDL | CodamaIDL
  programId: string
  projectName: string
}

export async function fetchProjectIdl(
  projectId: string,
  env: { DB: D1Database; IDLS: KVNamespace },
): Promise<FetchedProjectIdl | null> {
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
    `SELECT p.name, p.program_id, p.is_public, v.idl_json
     FROM projects p
     JOIN idl_versions v ON v.project_id = p.id
     WHERE p.id = ?
     ORDER BY v.version DESC LIMIT 1`,
  )
    .bind(projectId)
    .first<{ name: string; program_id: string; is_public: number; idl_json: string }>()

  if (!row || !row.is_public) return null

  try {
    const idl = JSON.parse(row.idl_json) as AnchorIDL | CodamaIDL
    return { idl, programId: row.program_id, projectName: row.name }
  } catch {
    return null
  }
}
